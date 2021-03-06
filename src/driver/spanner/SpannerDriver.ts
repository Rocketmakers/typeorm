import {Driver} from "../Driver";
import {ColumnType} from "../types/ColumnTypes";
import {SpannerConnectionOptions} from "./SpannerConnectionOptions";
import {RdbmsSchemaBuilder} from "../../schema-builder/RdbmsSchemaBuilder";
import {SpannerQueryRunner} from "./SpannerQueryRunner";
import {Connection} from "../../connection/Connection";
import {MappedColumnTypes} from "../types/MappedColumnTypes";
import {DataTypeDefaults} from "../types/DataTypeDefaults";
import {DriverPackageNotInstalledError} from "../../error/DriverPackageNotInstalledError";
import {PlatformTools} from "../../platform/PlatformTools";
import {ColumnMetadata} from "../../metadata/ColumnMetadata";
import {TableColumn} from "../../schema-builder/table/TableColumn";
import {TableOptions} from "../../schema-builder/options/TableOptions";
import {TableColumnOptions} from "../../schema-builder/options/TableColumnOptions";
import {TableIndexOptions} from "../../schema-builder/options/TableIndexOptions";
import {TableForeignKeyOptions} from "../../schema-builder/options/TableForeignKeyOptions";
import {TableUniqueOptions} from "../../schema-builder/options/TableUniqueOptions";
import {EntityMetadata} from "../../metadata/EntityMetadata";
import {DateUtils} from "../../util/DateUtils";
import {SpannerDatabase, SpannerExtendSchemas} from "./SpannerRawTypes";
import {Table} from "../../schema-builder/table/Table";
import {ObjectLiteral} from "../../common/ObjectLiteral";
import {DataTypeNotSupportedError} from "../../error/DataTypeNotSupportedError";


export const SpannerColumnUpdateWithCommitTimestamp = "commit_timestamp";

/**
 * Organizes communication with MySQL DBMS.
 */
export class SpannerDriver implements Driver {

    // -------------------------------------------------------------------------
    // Public Properties
    // -------------------------------------------------------------------------

    /**
     * Connection used by driver.
     */
    connection: Connection;

    /**
     * Spanner underlying library.
     */
    spannerLib: any;
    spanner: {
        client: any;
        instance: any;
        database: SpannerDatabase;
    } | null;

    /**
     * ddl parser to use mysql migrations as spanner ddl. 
     * https://github.com/duartealexf/sql-ddl-to-json-schema
     */
    ddlParser: any;


    // -------------------------------------------------------------------------
    // Public Implemented Properties
    // -------------------------------------------------------------------------

    /**
     * Connection options.
     */
    options: SpannerConnectionOptions;

    /**
     * Master database used to perform all write queries.
     */
    database?: string;

    /**
     * Indicates if replication is enabled.
     */
    isReplicated: boolean = false;

    /**
     * Indicates if tree tables are supported by this driver.
     */
    treeSupport = true;

    /**
     * Gets list of supported column data types by a driver.
     *
     * @see https://www.tutorialspoint.com/mysql/mysql-data-types.htm
     * @see https://dev.mysql.com/doc/refman/5.7/en/data-types.html
     */
    supportedDataTypes: ColumnType[] = [
        "int64",
        "bytes",
        "bool",
        "date",
        "float64",
        "string",
        "timestamp",
    ];

    /**
     * Gets list of spatial column data types.
     */
    spatialTypes: ColumnType[] = [
    ];

    /**
     * Gets list of column data types that support length by a driver.
     */
    withLengthColumnTypes: ColumnType[] = [
        "bytes",
        "string",
    ];

    /**
     * Gets list of column data types that support length by a driver.
     */
    withWidthColumnTypes: ColumnType[] = [
        "bytes",
        "string",
    ];

    /**
     * Gets list of column data types that support precision by a driver.
     */
    withPrecisionColumnTypes: ColumnType[] = [
        "float64",
    ];

    /**
     * Gets list of column data types that supports scale by a driver.
     */
    withScaleColumnTypes: ColumnType[] = [
        "float64",
    ];

    /**
     * Gets list of column data types that supports UNSIGNED and ZEROFILL attributes.
     */
    unsignedAndZerofillTypes: ColumnType[] = [
    ];

    /**
     * ORM has special columns and we need to know what database column types should be for those columns.
     * Column types are driver dependant.
     */
    mappedDataTypes: MappedColumnTypes = {
        createDate: "timestamp",
        createDateDefault: "CURRENT_TIMESTAMP()",
        updateDate: "timestamp",
        updateDateDefault: "CURRENT_TIMESTAMP()",
        version: "int64",
        treeLevel: "int64",
        migrationId: "int64",
        migrationName: "string",
        migrationTimestamp: "timestamp",
        cacheId: "int64",
        cacheIdentifier: "string",
        cacheTime: "int64",
        cacheDuration: "int64",
        cacheQuery: "string",
        cacheResult: "string",
    };

    /**
     * Default values of length, precision and scale depends on column data type.
     * Used in the cases when length/precision/scale is not specified by user.
     */
    dataTypeDefaults: DataTypeDefaults = {
        "string": { length: 255 },
        "date": { width: 10 },
        "bool": { width: 1 },
        "bytes": { length: 255 },
        "float64": { precision: 22 },
        "int64": { width: 20 }
    };

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(connection: Connection) {
        this.connection = connection;
        this.options = connection.options as SpannerConnectionOptions;

        // load mysql package
        this.loadDependencies();

    }

    // -------------------------------------------------------------------------
    // Public Methods (SpannerDriver specific)
    // -------------------------------------------------------------------------
    /**
     * returns spanner database object. used as databaseConnection of query runner.
     */
    async getDatabaseHandle(): Promise<any> {
        if (!this.spanner) {
            await this.connect();
            if (!this.spanner) {
                throw new Error('fail to reconnect');
            }
        }
        return this.spanner.database.handle;
    }
    /**
     * create and drop database of arbiter name. 
     * if name equals this.options.database, change driver state accordingly
     */
    createDatabase(name: string): Promise<any> {
        if (!this.spanner) {
            throw new Error('connect() driver first');
        }
        if (name == this.options.database) {
            return Promise.resolve(this.spanner.database.handle);
        }
        return this.spanner.instance.database(name).get({autoCreate:true});
    }
    dropDatabase(name: string): Promise<void> {
        if (!this.spanner) {
            throw new Error('connect() driver first');
        }
        if (name == this.options.database) {
            return this.spanner.database.handle.delete.then(() => {
                this.disconnect();
            });
        }
        return this.spanner.instance.database(name).delete();
    }
    /**
     * set tables object cache. 
     */
    setTable(table: Table) {
        if (!this.spanner) {
            throw new Error('connect() driver first!');
        }
        this.spanner.database.tables[table.name] = table;
        // for (const tableName in this.spanner.database.tables) {
        //     console.log('setTable', tableName, table);
        // }        
    }
    /**
     * load tables. cache them into this.spanner.databases too.
     * @param tableNames table names which need to load. 
     */
    loadTables(tableNames: string[]|Table|string): Promise<Table[]> {
      if (!this.spanner) {
        throw new Error('connect() driver first');
      }
      if (typeof tableNames === 'string') {
        tableNames = [tableNames];
      } else if (tableNames instanceof Table) {
        tableNames = [tableNames.name];
      }
        const database = this.spanner.database;
        return Promise.all(tableNames.map(async (tableName: string) => {
            let [dbname, name] = tableName.split(".");
            if (!name) {
                name = dbname;
            }
            if (Object.keys(database.tables).length === 0) {
                const handle = database.handle;
                const schemaResponse: string[][] = await handle.getSchema();
                const ddlStatements = schemaResponse[0]
                database.tables = await this.parseSchema(ddlStatements);
            }
            return database.tables[name];
        })).then(tables => tables.filter(t => !!t));
    }
    getDatabases(): string[] {
        return Object.keys([this.options.database]);
    }
    isSchemaTable(table: Table): boolean {
        return (this.options.schemaTableName || "schemas") === table.name;
    }

    // -------------------------------------------------------------------------
    // Public Methods
    // -------------------------------------------------------------------------

    /**
     * Performs connection to the database.
     */
    async connect(): Promise<void> {
        if (!this.spanner) {
			const Spanner = this.spannerLib.Spanner;
            // create objects
            const client = new Spanner({
                projectId: this.options.projectId,
                credenitals: this.options.credentials,
                keyFilename: this.options.keyFilename,
            });
            const instance = client.instance(this.options.instanceId);
            const database = instance.database(this.options.database);
            await database.get({ autoCreate: this.options.autoCreate });
            this.spanner = {
                client,
                instance,
                database: {
                    handle: database,
                    tables: {},
                    schemas: null,
                }
            };
            //actual database creation done in createDatabase (called from SpannerQueryRunner)
            return Promise.resolve();
        }
    }

    /**
     * Makes any action after connection (e.g. create extensions in Postgres driver).
     */
    afterConnect(): Promise<void> {
        return (async () => {
            if (!this.spanner) {
                throw new Error('connect() driver first');
            }
            const queryRunner = this.createQueryRunner("master");
            const extendSchemas = await queryRunner.createAndLoadSchemaTableIfNotExists(
                this.options.schemaTableName
            );
            this.spanner.database.schemas = this.updateTableWithExtendSchema(this.spanner.database, extendSchemas);
        })();
    }

    /**
     * Closes connection with the database.
     */
    async disconnect(): Promise<void> {
        this.spanner = null;
    }

    /**
     * Creates a schema builder used to build and sync a schema.
     */
    createSchemaBuilder() {
        return new RdbmsSchemaBuilder(this.connection);
    }

    /**
     * Creates a query runner used to execute database queries.
     */
    createQueryRunner(mode: "master"|"slave" = "master") {
        return new SpannerQueryRunner(this);
    }

    /**
     * Replaces parameters in the given sql with special escaping character
     * and an array of parameter names to be passed to a query.
     */
    escapeQueryWithParameters(sql: string, parameters: ObjectLiteral, nativeParameters: ObjectLiteral): [string, any[]] {
      const escapedParameters: any[] = Object.keys(nativeParameters).length > 0 ? [nativeParameters] : []
      if (!parameters || !Object.keys(parameters).length)
        return [sql, escapedParameters];

      const keys = Object.keys(parameters).map(parameter => "(:(\\.\\.\\.)?" + parameter + "\\b)").join("|");

      // console.log()
      // console.log('=================================================================================')
      // console.log('SpannerDriver.escapeQueryWithParameters')
      // console.log('sql', sql)
      // console.log('parameters', parameters)
      // console.log('nativeParameters', nativeParameters)
      // console.log('keys', keys)
      
      const sqlReplaced = sql.replace(new RegExp(keys, "g"), (key: string) => {
        // console.log('REPLACING KEY', key)
        const keyName = key.substr(0, 4) === ":..." ? key.substr(4) : key.substr(1)
        const value = parameters[keyName];
        const isArray = value instanceof Array

        if (value instanceof Function) {
          return value();
          
        } else {

          if (isArray) {
            return (value as any[]).map((v, i) => {
              const elementKeyName = `${keyName}${i}`
              escapedParameters.push({ [elementKeyName]: v })
              return `@${elementKeyName}`
            }).join(', ')
          } else {
            escapedParameters.push({ [keyName]: value });
            return `@${keyName}`;
          }

        }
      }); // todo: make replace only in value statements, otherwise problems

      // console.log('escapedParameters', escapedParameters)
      // console.log('=================================================================================')
      // console.log()

      return [sqlReplaced, escapedParameters];
    }

    /**
     * Escapes a column name.
     */
    escape(columnName: string): string {
        return "`" + columnName + "`";
    }

    /**
     * Build full table name with database name, schema name and table name.
     * E.g. "myDB"."mySchema"."myTable"
     * but spanner does not allow to prefix database name, we just returns table name.
     */
    buildTableName(tableName: string, schema?: string, database?: string): string {
        return tableName;
    }

    /**
     * Prepares given value to a value to be persisted, based on its column type and metadata.
     */
    preparePersistentValue(value: any, columnMetadata: ColumnMetadata): any {
        if (columnMetadata.transformer)
            value = columnMetadata.transformer.to(value);

        if (value === null || value === undefined)
            return value;

        if (columnMetadata.type === "timestamp" || 
            columnMetadata.type === "date" || 
            columnMetadata.type === Date) {
            return DateUtils.mixedDateToDate(value);

        } /*else if (columnMetadata.type === "simple-array") {
            return DateUtils.simpleArrayToString(value);

        } else if (columnMetadata.type === "simple-json") {
            return DateUtils.simpleJsonToString(value);
        } */ else if (
            columnMetadata.type === "int64" ||
            columnMetadata.type === "float64" ||
            columnMetadata.type === "bool" ||
            columnMetadata.type === "string" ||
            (<any>columnMetadata.type).name === "String" ||
            (<any>columnMetadata.type).name === "Number" ||
            columnMetadata.type === "bytes") {
            return value;
        }

        throw new DataTypeNotSupportedError(columnMetadata, columnMetadata.type, "spanner");
    }

    /**
     * Prepares given value to a value to be persisted, based on its column type or metadata.
     */
    prepareHydratedValue(value: any, columnMetadata: ColumnMetadata): any {
        if (value === null || value === undefined)
            return value;

        if (columnMetadata.type === "timestamp" || 
            columnMetadata.type === "date" || 
            columnMetadata.type === Date) {
            value = DateUtils.mixedDateToDate(value);

        } /*else if (columnMetadata.type === "simple-array") {
            value = DateUtils.simpleArrayToString(value);

        } else if (columnMetadata.type === "simple-json") {
            value = DateUtils.simpleJsonToString(value);
        } */ else if (
            columnMetadata.type == "int64" ||
            columnMetadata.type == "float64" ||
            columnMetadata.type == "bool" ||
            columnMetadata.type == "string" ||
            (<any>columnMetadata.type).name === "String" ||
            (<any>columnMetadata.type).name === "Number" ||
            columnMetadata.type == "bytes") {
        } else {
            throw new DataTypeNotSupportedError(columnMetadata, columnMetadata.type, "spanner");
        }

        if (columnMetadata.transformer)
            value = columnMetadata.transformer.from(value);

        return value;
    }

    /**
     * Creates a database type from a given column metadata.
     */
    normalizeType(column: { type: ColumnType, length?: number|string, precision?: number|null, scale?: number }): string {
        if (column.type === Number || column.type === "integer") {
            return "int64";

        } else if (column.type === String || column.type === "nvarchar") {
            return "string";

        } else if (column.type === Date) {
            return "timestamp";

        } else if ((column.type as any) === Buffer) {
            return "bytes";

        } else if (column.type === Boolean) {
            return "bool";

        } else if (column.type === "simple-array" || column.type === "simple-json") {
            return "string";

        } else {
            return column.type as string || "";
        }
    }

    /**
     * Normalizes "default" value of the column.
     */
    normalizeDefault(columnMetadata: ColumnMetadata): string {
        const defaultValue = columnMetadata.default;

        if (columnMetadata.isUpdateDate) {
            return SpannerColumnUpdateWithCommitTimestamp;

        } else if (typeof defaultValue === "number") {
            return "" + defaultValue;

        } else if (typeof defaultValue === "boolean") {
            return defaultValue === true ? "true" : "false";

        } else if (typeof defaultValue === "function") {
            return defaultValue();

        } else if (typeof defaultValue === "string") {
            return `'${defaultValue}'`;

        } else {
            return defaultValue;
        }
    }

    /**
     * Normalizes "isUnique" value of the column.
     */
    normalizeIsUnique(column: ColumnMetadata): boolean {
        return column.entityMetadata.indices.some(idx => idx.isUnique && idx.columns.length === 1 && idx.columns[0] === column);
    }

    /**
     * Returns default column lengths, which is required on column creation.
     */
    getColumnLength(column: ColumnMetadata|TableColumn): string {
        if (column.length)
            return column.length.toString();

        switch (column.type) {
            case String:
            case "string":
                return "255";
            case "bytes":
                return "255";
            default:
                return "";
        }
    }

    /**
     * Creates column type definition including length, precision and scale
     */
    createFullType(column: TableColumn): string {
        let type = column.type;

        // used 'getColumnLength()' method, because MySQL requires column length for `varchar`, `nvarchar` and `varbinary` data types
        if (this.getColumnLength(column)) {
            type += `(${this.getColumnLength(column)})`;

        } else if (column.width) {
            type += `(${column.width})`;

        } else if (column.precision !== null && column.precision !== undefined && column.scale !== null && column.scale !== undefined) {
            type += `(${column.precision},${column.scale})`;

        } else if (column.precision !== null && column.precision !== undefined) {
            type += `(${column.precision})`;
        }

        if (column.isArray)
            type = `Array<${type}>`;

        return type;
    }

    /**
     * Obtains a new database connection to a master server.
     * Used for replication.
     * If replication is not setup then returns default connection's database connection.
     */
    obtainMasterConnection(): Promise<any> {
        if (!this.spanner) {
            throw new Error(`no active database`);
        }
        return Promise.resolve(this.spanner.database.handle);
    }

    /**
     * Obtains a new database connection to a slave server.
     * Used for replication.
     * If replication is not setup then returns master (default) connection's database connection.
     */
    obtainSlaveConnection(): Promise<any> {
        return this.obtainMasterConnection();
    }

    /**
     * Creates generated map of values generated or returned by database after INSERT query.
     */
    createGeneratedMap(metadata: EntityMetadata, insertResult: any): ObjectLiteral|undefined {
      return {};
    //   const generatedMap = metadata.columns.reduce((map, column) => {
    //     let value: any;
    //     if (column.generationStrategy === "increment" && insertResult.insertId) {
    //         value = insertResult.insertId;
    //     }

    //     return OrmUtils.mergeDeep(map, column.createValueMap(value));
    // }, {} as ObjectLiteral);

    // return Object.keys(generatedMap).length > 0 ? generatedMap : undefined;
    }

    /**
     * Differentiate columns of this table and columns from the given column metadatas columns
     * and returns only changed.
     */
    findChangedColumns(tableColumns: TableColumn[], columnMetadatas: ColumnMetadata[]): ColumnMetadata[] {
        return columnMetadatas.filter(columnMetadata => {
            const tableColumn = tableColumns.find(c => c.name === columnMetadata.databaseName);
            if (!tableColumn)
                return false; // we don't need new columns, we only need exist and changed

            // console.log("table:", columnMetadata.entityMetadata.tableName);
            // console.log("name:", tableColumn.name, columnMetadata.databaseName);
            // console.log("type:", tableColumn.type, this.normalizeType(columnMetadata));
            // console.log("length:", tableColumn.length, columnMetadata.length);
            // console.log("width:", tableColumn.width, columnMetadata.width);
            // console.log("precision:", tableColumn.precision, columnMetadata.precision);
            // console.log("scale:", tableColumn.scale, columnMetadata.scale);
            // console.log("zerofill:", tableColumn.zerofill, columnMetadata.zerofill);
            // console.log("unsigned:", tableColumn.unsigned, columnMetadata.unsigned);
            // console.log("asExpression:", tableColumn.asExpression, columnMetadata.asExpression);
            // console.log("generatedType:", tableColumn.generatedType, columnMetadata.generatedType);
            // console.log("comment:", tableColumn.comment, columnMetadata.comment);
            // console.log("default:", tableColumn.default, columnMetadata.default);
            // console.log("default changed:", !this.compareDefaultValues(this.normalizeDefault(columnMetadata), tableColumn.default));
            // console.log("onUpdate:", tableColumn.onUpdate, columnMetadata.onUpdate);
            // console.log("isPrimary:", tableColumn.isPrimary, columnMetadata.isPrimary);
            // console.log("isNullable:", tableColumn.isNullable, columnMetadata.isNullable);
            // console.log("isUnique:", tableColumn.isUnique, this.normalizeIsUnique(columnMetadata));
            // console.log("isGenerated:", tableColumn.isGenerated, columnMetadata.isGenerated);
            // console.log("==========================================");

            return tableColumn.name !== columnMetadata.databaseName
                || tableColumn.type !== this.normalizeType(columnMetadata)
                || tableColumn.length !== columnMetadata.length
                || tableColumn.width !== columnMetadata.width
                || tableColumn.precision !== columnMetadata.precision
                || tableColumn.scale !== columnMetadata.scale
                || tableColumn.zerofill !== columnMetadata.zerofill
                || tableColumn.unsigned !== columnMetadata.unsigned
                || tableColumn.asExpression !== columnMetadata.asExpression
                || tableColumn.generatedType !== columnMetadata.generatedType
                // || tableColumn.comment !== columnMetadata.comment // todo
                || !this.compareDefaultValues(this.normalizeDefault(columnMetadata), tableColumn.default)
                || tableColumn.onUpdate !== columnMetadata.onUpdate
                || tableColumn.isPrimary !== columnMetadata.isPrimary
                || tableColumn.isNullable !== columnMetadata.isNullable
                || tableColumn.isUnique !== this.normalizeIsUnique(columnMetadata)
                || (columnMetadata.generationStrategy !== "uuid" && tableColumn.isGenerated !== columnMetadata.isGenerated);
        });
    }

    /**
     * Returns true if driver supports RETURNING / OUTPUT statement.
     */
    isReturningSqlSupported(): boolean {
        return false;
    }

    /**
     * Returns true if driver supports uuid values generation on its own.
     */
    isUUIDGenerationSupported(): boolean {
        return false;
    }

    /**
     * Creates an escaped parameter.
     */
    createParameter(parameterName: string, index: number): string {
        return `@${parameterName}`;
    }

    // -------------------------------------------------------------------------
    // Protected Methods
    // -------------------------------------------------------------------------

    /**
     * Loads all driver dependencies.
     */
    protected loadDependencies(): void {
        try {
            this.spannerLib = PlatformTools.load('@google-cloud/spanner');  // try to load first supported package
            if (this.options.migrationDDLType) {
                const parser = PlatformTools.load('sql-ddl-to-json-schema');
                this.ddlParser = new parser(this.options.migrationDDLType);
            } else {
                this.ddlParser = undefined;
            }
            /*
             * Some frameworks (such as Jest) may mess up Node's require cache and provide garbage for the 'mysql' module
             * if it was not installed. We check that the object we got actually contains something otherwise we treat
             * it as if the `require` call failed.
             *
             * @see https://github.com/typeorm/typeorm/issues/1373
             */
            [this.spannerLib, this.ddlParser].map((lib) => {
                if (lib && Object.keys(lib).length === 0) {
                    throw new Error("dependency was found but it is empty.");
                }
            });

        } catch (e) {
            throw new DriverPackageNotInstalledError("Spanner", "@google-cloud/spanner");
        }
    }

    /**
     * Checks if "DEFAULT" values in the column metadata and in the database are equal.
     */
    protected compareDefaultValues(columnMetadataValue: string, databaseValue: string): boolean {
        if (typeof columnMetadataValue === "string" && typeof databaseValue === "string") {
            // we need to cut out "'" because in mysql we can understand returned value is a string or a function
            // as result compare cannot understand if default is really changed or not
            columnMetadataValue = columnMetadataValue.replace(/^'+|'+$/g, "");
            databaseValue = databaseValue.replace(/^'+|'+$/g, "");
        }

        return columnMetadataValue === databaseValue;
    }

    /**
     * 
     */
    protected linkOptions(optionsMap: {[tableName: string]: TableOptions} ) {

    }

    /**
     * parse typename and return additional information required by TableColumn object.
     */
    protected parseTypeName(typeName: string): {
        typeName: string;
        isArray: boolean;
        length: number;
    } {
        const tm = typeName.match(/([^\(]+)\((\d+)\)/);
        if (tm) {
            return {
                typeName: tm[1].toLowerCase(),
                isArray: false,
                length: Number(tm[2])
            };
        } 
        const am = typeName.match(/([^<]+)<(\w+)>/);
        if (am) {
            return {
                typeName: typeName.toLowerCase(),
                isArray: true,
                length: 1
            }
        }
        return {
            typeName: typeName.toLowerCase(),
            isArray: false,
            length: 1
        }
    }

     /**
     * parse output of database.getSchema to generate Table object
     */
    private async parseSchema(ddlStatements: string[]): Promise<{[tableName: string]: Table}> {
        const tableOptionsMap: {[tableName: string]: TableOptions} = {};
        // console.log('================================================================')
        // console.log('PARSE SCHEMA')
        // console.log('statements', ddlStatements)
        // console.log('================================================================')
        for (const stmt of ddlStatements) {
            // console.log('stmt', stmt);
            // stmt =~ /CREATE ${tableName} (IF NOT EXISTS) (${columns}) ${interleaves}/
            /* example. 
            CREATE TABLE migrations (
                id INT64 NOT NULL,
                timestamp TIMESTAMP NOT NULL,
                name STRING(255) NOT NULL,
            ) PRIMARY KEY(id)
            in below regex, ,(?=\s*\)) is matched `,\n)` just before PRIMARY KEY
            */
            const m = stmt.match(/\s*CREATE\s+TABLE\s+(\w+)\s?[^\(]*\(([\s\S]*?),(?=\s*\))\s*\)([\s\S]*)/);
            if (!m) {
                // Just ignore indicies instead of throwing - we want to support migrations
                continue
                // throw new Error("invalid ddl format:" + stmt);
            }
            const tableName: string = m[1]; 
            const columnStmts: string = m[2];
            const indexStmts: string = m[3];
            // parse columns
            const columns: TableColumnOptions[] = [];
            for (const columnStmt of columnStmts.split(',')) {
                // console.log('columnStmt', columnStmt);
                const cm = columnStmt.match(/(\w+)\s+([\w\(\)]+)\s*([^\n]*)/);
                if (!cm) {
                    throw new Error("invalid ddl column format:" + columnStmt);
                }
                const type = this.parseTypeName(cm[2]);
                // check and store constraint with m[3]
                columns.push({
                    name: cm[1],
                    type: type.typeName,
                    isNullable: cm[3].indexOf("NOT NULL") < 0,
                    isGenerated: false, // set in updateTableWithExtendSchema
                    isPrimary: false, // set afterwards
                    isUnique: false, // set afterwards
                    isArray: type.isArray,
                    length: type.length.toString(), 
                    default: undefined, // set in updateTableWithExtendSchema
                    generationStrategy: undefined, // set in updateTableWithExtendSchema
                });
            }
            // parse primary and interleave statements
            const indices: TableIndexOptions[] = [];
            const foreignKeys: TableForeignKeyOptions[] = [];
            const uniques: TableUniqueOptions[] = [];
            // probably tweak required (need to see actual index/interleave statements format)
            if (indexStmts == null) {
                continue;
            }
            for (const idxStmt of (indexStmts.match(/(\w+[\w\s]+\([^)]+\)[^,]*)/g) || [])) {
                // console.log('idxStmt', idxStmt);
                // distinguish index and foreignKey. fk should contains INTERLEAVE
                if (idxStmt.indexOf("INTERLEAVE") == 0) {
                    // foreighkey
                    // idxStmt =~ INTERLEAVE IN PARENT ${this.escapeTableName(fk.referencedTableName)}
                    const im = idxStmt.match(/INTERLEAVE\s+IN\s+PARENT\s+(\w+)\s*\((\w+)\)/);
                    if (im) {
                        // foreignKeys.push({
                        //     name: tableName,
                        //     columnNames: [`${m[2]}_id`],
                        //     referencedTableName: m[2],
                        //     referencedColumnNames: [] // set afterwards (primary key column of referencedTable)
                        // });
                        // return m[0];
                        throw new Error("NYI spanner: handle interleaved index")
                    }
                } else if (idxStmt.indexOf("PRIMARY") == 0) {
                    // primary key
                    // idxStmt =~ PRIMARY KEY (${columns})
                    const pm = idxStmt.match(/PRIMARY\s+KEY\s*\(([^)]+)\)/);
                    if (pm) {
                        for (const primaryColumnName of pm[1].split(',').map(e => e.trim())) {
                            const options = columns.find(c => c.name == primaryColumnName);
                            if (options) {
                                options.isPrimary = true;
                            }
                        }
                    };
                } else {
                    // index
                    // idxStmt =~ (UNIQUE|NULL_FILTERED) INDEX ${name} ON ${tableName}(${columns})
                    const im = idxStmt.match(/(\w[\w\s]+?)\s+INDEX\s+(\w+)\s+ON\s+(\w+)\s*\(([^)]+)\)(.*)/);
                    if (im) {
                        const tableIndexOptions = {
                            name: im[2],
                            columnNames: im[4].split(",").map(e => e.trim()),
                            isUnique: im[1].indexOf("UNIQUE") >= 0,
                            isSpatial: im[1].indexOf("NULL_FILTERED") >= 0
                        };
                        indices.push(tableIndexOptions);
                        if (tableIndexOptions.isUnique) {
                            uniques.push({
                                name: tableIndexOptions.name,
                                columnNames: tableIndexOptions.columnNames
                            });
                            for (const uniqueColumnName of tableIndexOptions.columnNames) {
                                const options = columns.find(c => c.name == uniqueColumnName);
                                if (options) {
                                    options.isUnique = true;
                                }
                            }
                        }
                    }
                }
            }
            tableOptionsMap[tableName] = {
                name: tableName,
                columns,
                indices,
                foreignKeys,
                uniques
            };
        }
        this.linkOptions(tableOptionsMap);
        const result: { [tableName:string]: Table } = {};
        for (const tableName in tableOptionsMap) {
            result[tableName] = new Table(tableOptionsMap[tableName]);
        }
        return result;
    }

    protected updateTableWithExtendSchema(db: SpannerDatabase, extendSchemas: SpannerExtendSchemas) {
        for (const tableName in db.tables) {
            const table = db.tables[tableName];
            const extendSchema = extendSchemas[tableName];
            if (extendSchema) {
                for (const columnName in extendSchema) {
                    const columnSchema = extendSchema[columnName];
                    const column = table.findColumnByName(columnName);
                    if (column) {
                        column.isGenerated = !!columnSchema.generator;
                        column.default = columnSchema.default;
                        column.generationStrategy = columnSchema.generatorStorategy;
                    } else {
                        console.log(`extendSchema for column ${columnName} exists but table does not have it`);
                        // throw new Error(`extendSchema for column ${columnName} exists but table does not have it`);
                      }
                }
            }
            // console.log('table', tableName, table);
        }

        return extendSchemas
    }
}
