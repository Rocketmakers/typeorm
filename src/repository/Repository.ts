import {DeepPartial} from "../common/DeepPartial";
import {ObjectLiteral} from "../common/ObjectLiteral";
import {ObjectID} from "../driver/mongodb/typings";
import {EntityManager} from "../entity-manager/EntityManager";
import {FindExtraOptions, FindOptions, FindOptionsWhere} from "../find-options/FindOptions";
import {EntityMetadata} from "../metadata/EntityMetadata";
import {QueryPartialEntity} from "../query-builder/QueryPartialEntity";
import {DeleteResult} from "../query-builder/result/DeleteResult";
import {InsertResult} from "../query-builder/result/InsertResult";
import {UpdateResult} from "../query-builder/result/UpdateResult";
import {SelectQueryBuilder} from "../query-builder/SelectQueryBuilder";
import {QueryRunner} from "../query-runner/QueryRunner";
import {RemoveOptions} from "./RemoveOptions";
import {SaveOptions} from "./SaveOptions";
import * as Observable from "zen-observable";

/**
 * Repository is supposed to work with your entity objects. Find entities, insert, update, delete, etc.
 */
export class Repository<Entity extends ObjectLiteral> {

    // -------------------------------------------------------------------------
    // Public Properties
    // -------------------------------------------------------------------------

    /**
     * Entity Manager used by this repository.
     */
    readonly manager: EntityManager;

    /**
     * Entity metadata of the entity current repository manages.
     */
    readonly metadata: EntityMetadata;

    /**
     * Query runner provider used for this repository.
     */
    readonly queryRunner?: QueryRunner;

    // -------------------------------------------------------------------------
    // Public Methods
    // -------------------------------------------------------------------------

    /**
     * Creates a new query builder that can be used to build a sql query.
     */
    createQueryBuilder(alias?: string, queryRunner?: QueryRunner): SelectQueryBuilder<Entity> {
        return this.manager.createQueryBuilder(this.metadata.target, alias || this.metadata.targetName, queryRunner || this.queryRunner);
    }

    /**
     * Returns object that is managed by this repository.
     * If this repository manages entity from schema,
     * then it returns a name of that schema instead.
     */
    get target(): Function|string {
        return this.metadata.target;
    }

    /**
     * Checks if entity has an id.
     * If entity composite compose ids, it will check them all.
     */
    hasId(entity: Entity): boolean {
        return this.manager.hasId(this.metadata.target, entity);
    }

    /**
     * Gets entity mixed id.
     */
    getId(entity: Entity): any {
        return this.manager.getId(this.metadata.target, entity);
    }

    /**
     * Creates a new entity instance.
     */
    create(): Entity;

    /**
     * Creates a new entities and copies all entity properties from given objects into their new entities.
     * Note that it copies only properties that present in entity schema.
     */
    create(entityLikeArray: DeepPartial<Entity>[]): Entity[];

    /**
     * Creates a new entity instance and copies all entity properties from this object into a new entity.
     * Note that it copies only properties that present in entity schema.
     */
    create(entityLike: DeepPartial<Entity>): Entity;

    /**
     * Creates a new entity instance or instances.
     * Can copy properties from the given object into new entities.
     */
    create(plainEntityLikeOrPlainEntityLikes?: DeepPartial<Entity>|DeepPartial<Entity>[]): Entity|Entity[] {
        return this.manager.create<any>(this.metadata.target, plainEntityLikeOrPlainEntityLikes as any);
    }

    /**
     * Merges multiple entities (or entity-like objects) into a given entity.
     */
    merge(mergeIntoEntity: Entity, ...entityLikes: DeepPartial<Entity>[]): Entity {
        return this.manager.merge(this.metadata.target, mergeIntoEntity, ...entityLikes);
    }

    /**
     * Creates a new entity from the given plan javascript object. If entity already exist in the database, then
     * it loads it (and everything related to it), replaces all values with the new ones from the given object
     * and returns this new entity. This new entity is actually a loaded from the db entity with all properties
     * replaced from the new object.
     *
     * Note that given entity-like object must have an entity id / primary key to find entity by.
     * Returns undefined if entity with given id was not found.
     */
    preload(entityLike: DeepPartial<Entity>): Promise<Entity|undefined> {
        return this.manager.preload(this.metadata.target, entityLike);
    }

    /**
     * Saves all given entities in the database.
     * If entities do not exist in the database then inserts, otherwise updates.
     */
    save<T extends DeepPartial<Entity>>(entities: T[], options?: SaveOptions): Promise<T[]>;

    /**
     * Saves a given entity in the database.
     * If entity does not exist in the database then inserts, otherwise updates.
     */
    save<T extends DeepPartial<Entity>>(entity: T, options?: SaveOptions): Promise<T>;

    /**
     * Saves one or many given entities.
     */
    save<T extends DeepPartial<Entity>>(entityOrEntities: T|T[], options?: SaveOptions): Promise<T|T[]> {
        return this.manager.save(this.metadata.target, entityOrEntities as any, options);
    }

    /**
     * Removes a given entities from the database.
     */
    remove(entities: Entity[], options?: RemoveOptions): Promise<Entity[]>;

    /**
     * Removes a given entity from the database.
     */
    remove(entity: Entity, options?: RemoveOptions): Promise<Entity>;

    /**
     * Removes one or many given entities.
     */
    remove(entityOrEntities: Entity|Entity[], options?: RemoveOptions): Promise<Entity|Entity[]> {
        return this.manager.remove(this.metadata.target, entityOrEntities as any, options);
    }

    /**
     * Inserts a given entity into the database.
     * Unlike save method executes a primitive operation without cascades, relations and other operations included.
     * Executes fast and efficient INSERT query.
     * Does not check if entity exist in the database, so query will fail if duplicate entity is being inserted.
     */
    insert(entity: QueryPartialEntity<Entity>|(QueryPartialEntity<Entity>[]), options?: SaveOptions): Promise<InsertResult> {
        return this.manager.insert(this.metadata.target, entity, options);
    }

    /**
     * Updates entity partially. Entity can be found by a given conditions.
     * Unlike save method executes a primitive operation without cascades, relations and other operations included.
     * Executes fast and efficient UPDATE query.
     * Does not check if entity exist in the database.
     */
    update(criteria: string|string[]|number|number[]|Date|Date[]|ObjectID|ObjectID[]|FindOptionsWhere<Entity>, partialEntity: DeepPartial<Entity>, options?: SaveOptions): Promise<UpdateResult> {
        return this.manager.update(this.metadata.target, criteria as any, partialEntity, options);
    }

    /**
     * Deletes entities by a given criteria.
     * Unlike save method executes a primitive operation without cascades, relations and other operations included.
     * Executes fast and efficient DELETE query.
     * Does not check if entity exist in the database.
     */
    delete(criteria: string|string[]|number|number[]|Date|Date[]|ObjectID|ObjectID[]|FindOptionsWhere<Entity>, options?: RemoveOptions): Promise<DeleteResult> {
        return this.manager.delete(this.metadata.target, criteria as any, options);
    }

    /**
     * Finds entities that match given options.
     */
    find(options?: FindOptions<Entity>): Promise<Entity[]>;

    /**
     * Finds entities that match given conditions.
     */
    find(conditions?: FindOptionsWhere<Entity>): Promise<Entity[]>;

    /**
     * Finds entities that match given find options or conditions.
     */
    find(optionsOrConditions?: FindOptions<Entity>|FindOptionsWhere<Entity>): Promise<Entity[]> {
        return this.manager.find(this.metadata.target, optionsOrConditions as any);
    }

    /**
     * Finds entities that match given find options.
     * Also counts all entities that match given conditions,
     * but ignores pagination settings (from and take options).
     */
    findAndCount(options?: FindOptions<Entity>): Promise<[ Entity[], number ]>;

    /**
     * Finds entities that match given conditions.
     * Also counts all entities that match given conditions,
     * but ignores pagination settings (from and take options).
     */
    findAndCount(conditions?: FindOptionsWhere<Entity>): Promise<[ Entity[], number ]>;

    /**
     * Finds entities that match given find options or conditions.
     * Also counts all entities that match given conditions,
     * but ignores pagination settings (from and take options).
     */
    findAndCount(optionsOrConditions?: FindOptions<Entity>|FindOptionsWhere<Entity>): Promise<[ Entity[], number ]> {
        return this.manager.findAndCount(this.metadata.target, optionsOrConditions as any);
    }

    /**
     * Finds entities by ids.
     * Optionally find options can be applied.
     */
    findByIds(ids: any[], options?: FindOptions<Entity>): Promise<Entity[]>;

    /**
     * Finds entities by ids.
     * Optionally conditions can be applied.
     */
    findByIds(ids: any[], conditions?: FindOptionsWhere<Entity>): Promise<Entity[]>;

    /**
     * Finds entities by ids.
     * Optionally find options can be applied.
     */
    findByIds(ids: any[], optionsOrConditions?: FindOptions<Entity>|FindOptionsWhere<Entity>): Promise<Entity[]> {
        return this.manager.findByIds(this.metadata.target, ids, optionsOrConditions as any);
    }

    /**
     * Finds first entity that matches given options.
     */
    findOne(id?: string|number|Date|ObjectID, options?: FindOptions<Entity>): Promise<Entity|undefined>;

    /**
     * Finds first entity that matches given options.
     */
    findOne(options?: FindOptions<Entity>): Promise<Entity|undefined>;

    /**
     * Finds first entity that matches given conditions.
     */
    findOne(conditions?: FindOptionsWhere<Entity>, options?: FindOptions<Entity>): Promise<Entity|undefined>;

    /**
     * Finds first entity that matches given conditions.
     */
    findOne(optionsOrConditions?: string|number|Date|ObjectID|FindOptions<Entity>|FindOptionsWhere<Entity>, maybeOptions?: FindOptions<Entity>): Promise<Entity|undefined> {
        return this.manager.findOne(this.metadata.target, optionsOrConditions as any, maybeOptions);
    }

    /**
     * Finds first entity that matches given options.
     */
    findOneOrFail(id?: string|number|Date|ObjectID, options?: FindOptions<Entity>): Promise<Entity>;

    /**
     * Finds first entity that matches given options.
     */
    findOneOrFail(options?: FindOptions<Entity>): Promise<Entity>;

    /**
     * Finds first entity that matches given conditions.
     */
    findOneOrFail(conditions?: FindOptionsWhere<Entity>, options?: FindOptions<Entity>): Promise<Entity>;

    /**
     * Finds first entity that matches given conditions.
     */
    findOneOrFail(optionsOrConditions?: string|number|Date|ObjectID|FindOptions<Entity>|FindOptionsWhere<Entity>, maybeOptions?: FindOptions<Entity>): Promise<Entity> {
        return this.manager.findOneOrFail(this.metadata.target, optionsOrConditions as any, maybeOptions);
    }

    /**
     * Counts entities that match given conditions.
     */
    count(conditions?: FindOptionsWhere<Entity>, options?: FindExtraOptions): Promise<number> {
        return this.manager.count(this.metadata.target, conditions, options);
    }

    /**
     * Finds entities that match given options and returns observable.
     * Whenever new data appears that matches given query observable emits new value.
     */
    observe<Entity>(options?: FindOptions<Entity>): Observable<Entity[]>;

    /**
     * Finds entities that match given conditions and returns observable.
     * Whenever new data appears that matches given query observable emits new value.
     */
    observe<Entity>(conditions?: FindOptionsWhere<Entity>): Observable<Entity[]>;

    /**
     * Finds entities that match given options and returns observable.
     * Whenever new data appears that matches given query observable emits new value.
     */
    observe<Entity>(optionsOrConditions?: FindOptions<Entity>|FindOptionsWhere<Entity>): Observable<Entity[]> {
        return this.manager.observe(this.metadata.target, optionsOrConditions as any);
    }

    /**
     * Finds entities and count that match given options and returns observable.
     * Whenever new data appears that matches given query observable emits new value.
     */
    observeManyAndCount<Entity>(options?: FindOptions<Entity>): Observable<[Entity[], number]>;

    /**
     * Finds entities and count that match given conditions and returns observable.
     * Whenever new data appears that matches given query observable emits new value.
     */
    observeManyAndCount<Entity>(conditions?: FindOptionsWhere<Entity>): Observable<[Entity[], number]>;

    /**
     * Finds entities and count that match given options and returns observable.
     * Whenever new data appears that matches given query observable emits new value.
     */
    observeManyAndCount<Entity>(optionsOrConditions?: FindOptions<Entity>|FindOptionsWhere<Entity>): Observable<[Entity[], number]> {
        return this.manager.observeManyAndCount(this.metadata.target, optionsOrConditions as any);
    }

    /**
     * Finds entity that match given options and returns observable.
     * Whenever new data appears that matches given query observable emits new value.
     */
    observeOne<Entity>(options?: FindOptions<Entity>): Observable<Entity>;

    /**
     * Finds entity that match given conditions and returns observable.
     * Whenever new data appears that matches given query observable emits new value.
     */
    observeOne<Entity>(conditions?: FindOptionsWhere<Entity>): Observable<Entity>;

    /**
     * Finds entity that match given options and returns observable.
     * Whenever new data appears that matches given query observable emits new value.
     */
    observeOne<Entity>(optionsOrConditions?: FindOptions<Entity>|FindOptionsWhere<Entity>): Observable<Entity> {
        return this.manager.observeOne(this.metadata.target, optionsOrConditions as any);
    }

    /**
     * Gets the entities count match given options and returns observable.
     * Whenever new data appears that matches given query observable emits new value.
     */
    observeCount<Entity>(options?: FindOptions<Entity>): Observable<number>;

    /**
     * Gets the entities count match given options and returns observable.
     * Whenever new data appears that matches given query observable emits new value.
     */
    observeCount<Entity>(conditions?: FindOptionsWhere<Entity>): Observable<number>;

    /**
     * Gets the entities count match given options and returns observable.
     * Whenever new data appears that matches given query observable emits new value.
     */
    observeCount<Entity>(optionsOrConditions?: FindOptions<Entity>|FindOptionsWhere<Entity>): Observable<number> {
        return this.manager.observeCount(this.metadata.target, optionsOrConditions as any);
    }

    /**
     * Executes a raw SQL query and returns a raw database results.
     * Raw query execution is supported only by relational databases (MongoDB is not supported).
     */
    query(query: string, parameters?: any[]): Promise<any> {
        return this.manager.query(query, parameters);
    }

    /**
     * Clears all the data from the given table/collection (truncates/drops it).
     *
     * Note: this method uses TRUNCATE and may not work as you expect in transactions on some platforms.
     * @see https://stackoverflow.com/a/5972738/925151
     */
    clear(): Promise<void> {
        return this.manager.clear(this.metadata.target);
    }

    /**
     * Increments some column by provided value of the entities matched given conditions.
     */
    increment(conditions: FindOptionsWhere<Entity>, propertyPath: string, value: number): Promise<void> {
        return this.manager.increment(this.metadata.target, conditions, propertyPath, value);
    }

    /**
     * Decrements some column by provided value of the entities matched given conditions.
     */
    decrement(conditions: FindOptionsWhere<Entity>, propertyPath: string, value: number): Promise<void> {
        return this.manager.decrement(this.metadata.target, conditions, propertyPath, value);
    }

}