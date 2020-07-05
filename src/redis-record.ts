import { performance } from 'perf_hooks';
import joi, { Schema, SchemaMap } from '@hapi/joi';
import { v4 as uuid } from 'uuid';
import IORedis from 'ioredis';

// import { InvalidRedisStoreConfig } from './redis-store-error';

export interface RedisRecordConfig {
  name: string;
  redisClient: IORedis.Redis;
  primaryKeys?: string[];
  lookupKeys?: string[];
  redisPrimaryKeyIndexKey: string;
  redisLookupKeyIndexKey: string;
}

export interface CreatedRecord {
  id: string;
}

export class RedisRecord {
  static delimiter = ':';

  private redisRecordConfig: Required<RedisRecordConfig>;

  private createOneSchema: Schema | undefined;
  private autoGenerateId = false;

  constructor(redisRecordConfig: Omit<RedisRecordConfig, 'redisPrimaryKeyIndexKey' | 'redisLookupKeyIndexKey'>) {
    this.redisRecordConfig = this.getValidatedConfig(redisRecordConfig);
    this.autoGenerateId = this.redisRecordConfig.primaryKeys.length === 0;
  }

  async createOne(data: Record<string, string>): Promise<CreatedRecord> {
    const validatedData = (await this.getCreateOneSchema().validateAsync(data)) as Record<string, string>;
    const {
      primaryKeys,
      name,
      redisClient,
      redisPrimaryKeyIndexKey,
      lookupKeys,
      redisLookupKeyIndexKey
    } = this.redisRecordConfig;

    const id = this.autoGenerateId
      ? uuid()
      : // eslint-disable-next-line security/detect-object-injection
        primaryKeys.map((primaryKey) => validatedData[primaryKey]).join(RedisRecord.delimiter);

    const redisKey = `${name}${RedisRecord.delimiter}${id}`;
    const timestamp = String(performance.timeOrigin + performance.now());

    const pipeline = redisClient.pipeline();
    pipeline.hmset(redisKey, { id, timestamp, ...validatedData });
    // create primary key index
    pipeline.zadd(redisPrimaryKeyIndexKey, timestamp, redisKey);
    // create lookup key index
    lookupKeys
      // eslint-disable-next-line security/detect-object-injection
      .filter((lookupKey) => !!data[lookupKey])
      .forEach((lookupKey) => {
        pipeline.zadd(
          redisLookupKeyIndexKey,
          '0',
          // eslint-disable-next-line security/detect-object-injection
          `${lookupKey}${RedisRecord.delimiter}${this.getLookupKeyIndexValue(data[lookupKey])}${
            RedisRecord.delimiter
          }${timestamp}${RedisRecord.delimiter}${id}`
        );
      });

    void getPipelineResult(
      pipeline.exec()
      // // eslint-disable-next-line security/detect-non-literal-fs-filename
      // redisClient
      //   .pipeline()
      //   .hmset(redisKey, { id, timestamp, ...validatedData })
      //   .zadd(redisPrimaryKeyIndexKey, timestamp, redisKey)
      //   .exec()
    );

    return { id };
  }

  async findById(id: string): Promise<Record<string, string> | undefined> {
    const value = await this.redisRecordConfig.redisClient.hgetall(
      `${this.redisRecordConfig.name}${RedisRecord.delimiter}${id}`
    );
    return Object.keys(value).length === 0 ? undefined : value;
  }

  // async findByLookupKey(
  //   lookupKey: string,
  //   lookupKeyValue: string,
  //   reverseOrder: false,
  //   limit?: number
  // ): Promise<Record<string, string> | undefined> {
  //   const { redisLookupKeyIndexKey, redisClient, name } = this.redisRecordConfig;
  //   const searchKey = `${lookupKey}${RedisRecord.delimiter}${this.getLookupKeyIndexValue(lookupKeyValue)}${
  //     RedisRecord.delimiter
  //   }`;

  //   const result = await redisClient[reverseOrder ? 'zrevrangebylex' : 'zrangebylex'](
  //     redisLookupKeyIndexKey,
  //     `[${searchKey}\xff`,
  //     `[${searchKey}`,
  //     ...['LIMIT', '0', String(limit)]
  //     // ...(limit ? ['LIMIT', 0, limit] : [])
  //   );

  //   if (result.length) {
  //     const [, , , id] = result[0].split(RedisRecord.delimiter);
  //     return redisClient.hgetall(`${name}${RedisRecord.delimiter}${id}`);
  //   }

  //   return undefined;
  // }

  async findOneByLookupKey(lookupKey: string, lookupKeyValue: string): Promise<Record<string, string> | undefined> {
    const { redisLookupKeyIndexKey, redisClient, name } = this.redisRecordConfig;
    const searchKey = `${lookupKey}${RedisRecord.delimiter}${this.getLookupKeyIndexValue(lookupKeyValue)}${
      RedisRecord.delimiter
    }`;
    const result = await redisClient.zrevrangebylex(
      redisLookupKeyIndexKey,
      `[${searchKey}\xff`,
      `[${searchKey}`,
      'LIMIT',
      0,
      1
    );

    if (result.length) {
      const [, , , id] = result[0].split(RedisRecord.delimiter);
      return redisClient.hgetall(`${name}${RedisRecord.delimiter}${id}`);
    }

    return undefined;
  }

  async findAll(): Promise<Record<string, string>[]> {
    const { redisClient, redisPrimaryKeyIndexKey } = this.redisRecordConfig;
    const redisKeys = await redisClient.zrange(redisPrimaryKeyIndexKey, 0, -1);

    return getPipelineResult(
      redisClient.pipeline(redisKeys.map((redisKey) => ['hgetall', redisKey])).exec()
    ) as Promise<Record<string, string>[]>;
  }

  async deleteAll(): Promise<void> {
    const { redisClient, redisPrimaryKeyIndexKey, redisLookupKeyIndexKey } = this.redisRecordConfig;
    const redisKeys = await redisClient.zrange(redisPrimaryKeyIndexKey, 0, -1);

    void getPipelineResult(
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      redisClient
        .multi(redisKeys.map((redisKey) => ['del', redisKey]))
        .watch(redisPrimaryKeyIndexKey, redisLookupKeyIndexKey)
        .del(redisPrimaryKeyIndexKey)
        .del(redisLookupKeyIndexKey)
        .exec()
    );
  }

  // async getById(id: string) {}

  getValidatedConfig(
    redisRecordConfig: Omit<RedisRecordConfig, 'redisPrimaryKeyIndexKey' | 'redisLookupKeyIndexKey'>
  ): Required<RedisRecordConfig> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { value, error } = joi
      .object({
        name: joi.string().trim().required(),
        redisClient: joi.any().required(),
        primaryKeys: joi.array().items(joi.string()).default([]),
        lookupKeys: joi.array().items(joi.string()).default([])
      })
      .validate(redisRecordConfig);

    if (error) throw error;

    return {
      ...value,
      redisPrimaryKeyIndexKey: `${(value as RedisRecordConfig).name}${RedisRecord.delimiter}pk${
        RedisRecord.delimiter
      }idx`,
      redisLookupKeyIndexKey: `${(value as RedisRecordConfig).name}${RedisRecord.delimiter}lk${
        RedisRecord.delimiter
      }idx`
    } as Required<RedisRecordConfig>;
  }

  getCreateOneSchema(): Schema {
    if (!this.createOneSchema) {
      this.createOneSchema = joi
        .object({
          ...this.getDefaultSchema(this.redisRecordConfig.primaryKeys),
          ...this.getDefaultSchema(this.redisRecordConfig.lookupKeys)
        })
        .unknown(true);
    }
    return this.createOneSchema;
  }

  getDefaultSchema(fields: string[]): SchemaMap {
    return fields.reduce((schema: SchemaMap, field: string) => {
      return { ...schema, [field]: joi.string().trim().required() };
    }, {});
  }

  getLookupKeyIndexValue(value: string): string {
    // eslint-disable-next-line security/detect-non-literal-regexp
    return value.replace(new RegExp(RedisRecord.delimiter, 'g'), '');
  }
}

async function getPipelineResult(pipelineResult: Promise<[Error | null, unknown][]>): Promise<unknown[]> {
  const errors: (Error | null)[] = [];
  const values: unknown[] = [];

  (await pipelineResult).forEach(([error, value]) => {
    if (error) errors.push(error);
    values.push(value);
  });

  if (errors.length) {
    throw errors;
  }

  return values;
}
