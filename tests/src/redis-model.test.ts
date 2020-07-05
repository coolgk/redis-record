import IORedis from 'ioredis';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { nanoid } from 'nanoid';

chai.use(chaiAsPromised);

import { RedisRecord, RedisRecordConfig, CreatedRecord } from 'src/redis-record';

describe('Redis Model', () => {
  let redisClient: IORedis.Redis;

  before(() => {
    redisClient = new IORedis();
  });
  after(() => {
    redisClient.disconnect();
  });

  context('given name is undefined in redisRecordConfig', () => {
    const redisRecordConfig: RedisRecordConfig = { redisClient } as RedisRecordConfig;
    context('when creating a redisRecord object', () => {
      it('should throw invalid error definition error', () => {
        expect(() => new RedisRecord(redisRecordConfig)).to.throw();
      });
    });
  });

  context('given name is an empty string in redisRecordConfig', () => {
    const redisRecordConfig = { redisClient, name: '' };
    context('when creating a redisRecord object', () => {
      it('should throw invalid error definition error', () => {
        expect(() => new RedisRecord(redisRecordConfig)).to.throw();
      });
    });
  });

  context('given name is a string of spaces in redisRecordConfig', () => {
    const redisRecordConfig = { redisClient, name: '      ' };
    context('when creating a redisRecord object', () => {
      it('should throw invalid error definition error', () => {
        expect(() => new RedisRecord(redisRecordConfig)).to.throw();
      });
    });
  });

  context('given primary keys are not provided in redisRecordConfig', () => {
    let redisRecord: RedisRecord;
    const recordName = nanoid(10);

    before(() => {
      const redisRecordConfig = { redisClient, name: recordName };
      redisRecord = new RedisRecord(redisRecordConfig);
    });

    after(() => {
      return redisRecord.deleteAll();
    });

    context('when creating a new record', () => {
      let createdRecord: CreatedRecord;
      const email = nanoid();
      const password = nanoid();
      // const timestampBeforeCreateOne = Date.now();

      before(async () => {
        createdRecord = await redisRecord.createOne({ email, password });
      });

      it('should generate an id and redis key for the record', () => {
        expect(createdRecord).to.have.property('id');
        // expect(createdRecord).to.have.property('redisKey'); // this is implementation, shouldn't be tested
      });

      it('should store value in redis', async () => {
        const record = await redisClient.hgetall(`${recordName}:${createdRecord.id}`);
        expect(record).to.have.property('email', email);
        expect(record).to.have.property('password', password);
      });
    });
  });

  context('given primary keys have been provided in redisRecordConfig', () => {
    let redisRecord: RedisRecord;
    const recordName = nanoid(10);
    const primaryKey = 'clientId';

    before(() => {
      const redisRecordConfig = { redisClient, name: recordName, primaryKeys: [primaryKey] };
      redisRecord = new RedisRecord(redisRecordConfig);
    });

    after(() => {
      return redisRecord.deleteAll();
    });

    context('when creating a new record without primary keys', () => {
      it('should throw validation error', () => {
        return expect(redisRecord.createOne({ email: 'email', password: 'password' })).to.be.rejected;
      });
    });

    context('when creating a new record with primary keys', () => {
      let createdRecord: CreatedRecord;
      const email = nanoid();
      const password = nanoid();
      const primaryKeyValue = nanoid();

      before(async () => {
        createdRecord = await redisRecord.createOne({ email, password, [primaryKey]: primaryKeyValue });
      });

      it('should store value in redis', async () => {
        const record = await redisClient.hgetall(`${recordName}:${createdRecord.id}`);
        expect(record).to.have.property('email', email);
        expect(record).to.have.property('password', password);
      });

      // shouldn't test implementation
      // it('should use primary key value as id', () => {
      //   expect(createdRecord.id).to.equal(primaryKeyValue);
      // });

      // shouldn't test implementation
      // it('should use primary key value in redis key', () => {
      //   expect(createdRecord.redisKey.indexOf(primaryKeyValue)).to.equal(
      //     createdRecord.redisKey.length - primaryKeyValue.length
      //   );
      // });
    });
  });

  context('given some records have been created', () => {
    let redisRecord: RedisRecord;

    const recordName = nanoid(10);
    const values = [1, 2, 3].map((number) => ({ email: `${number}${nanoid()}`, password: `${number}${nanoid()}` }));
    const createdRecords: CreatedRecord[] = [];

    before(async () => {
      const redisRecordConfig = { redisClient, name: recordName };
      redisRecord = new RedisRecord(redisRecordConfig);
      createdRecords.push(await redisRecord.createOne(values[0]));
      createdRecords.push(await redisRecord.createOne(values[1]));
      createdRecords.push(await redisRecord.createOne(values[2]));
    });

    after(() => {
      return redisRecord.deleteAll();
    });

    context('when findAll() is called', () => {
      let allRecords: Record<string, string>[];

      before(async () => {
        allRecords = await redisRecord.findAll();
      });

      it('should find all records created', () => {
        const allValues = [];
        for (let i = 0; i < allRecords.length; i++) {
          // eslint-disable-next-line security/detect-object-injection
          const { id, timestamp, ...values } = allRecords[i];
          expect(id).is.a('string');
          expect(parseFloat(timestamp)).to.equal(Number(timestamp));
          allValues.push(values);
        }
        expect(allValues).to.eql(values);
      });
    });

    context('when findById is called with an id exists', () => {
      let record: Record<string, string> | undefined;

      before(async () => {
        record = await redisRecord.findById(createdRecords[0].id);
      });

      it('should find the record', () => {
        expect(record).to.have.property('email', values[0].email);
        expect(record).to.have.property('password', values[0].password);
      });
    });

    context('when findById is called with an id does not exists', () => {
      let record: Record<string, string> | undefined;

      before(async () => {
        record = await redisRecord.findById(nanoid());
      });

      it('should find the record', () => {
        expect(record).to.be.undefined;
      });
    });
  });

  context('given NO records exist', () => {
    let redisRecord: RedisRecord;
    const recordName = nanoid(10);

    before(() => {
      const redisRecordConfig = { redisClient, name: recordName };
      redisRecord = new RedisRecord(redisRecordConfig);
    });

    after(() => {
      return redisRecord.deleteAll();
    });

    context('when findAll() is called', () => {
      let allRecords: Record<string, string>[];

      before(async () => {
        allRecords = await redisRecord.findAll();
      });

      it('should return an empty array', () => {
        expect(allRecords).to.be.empty;
      });
    });

    context('when findById is called', () => {
      let record: Record<string, string> | undefined;

      before(async () => {
        record = await redisRecord.findById(nanoid());
      });

      it('should return null', () => {
        expect(record).to.be.undefined;
      });
    });
  });

  context('given lookup keys have been provided in redisRecordConfig', () => {
    let redisRecord: RedisRecord;
    const recordName = nanoid(10);
    const lookupKey = nanoid(10);

    before(() => {
      const redisRecordConfig = { redisClient, name: recordName, lookupKeys: [lookupKey] };
      redisRecord = new RedisRecord(redisRecordConfig);
    });

    after(() => {
      return redisRecord.deleteAll();
    });

    context('when creating a new record with lookup keys', () => {
      let createdRecord: CreatedRecord;
      const email = nanoid();
      const lookupKeyValue = nanoid();

      before(async () => {
        createdRecord = await redisRecord.createOne({ email, [lookupKey]: lookupKeyValue });
      });

      it('should store value in redis', async () => {
        const record = await redisClient.hgetall(`${recordName}:${createdRecord.id}`);
        expect(record).to.have.property('email', email);
        expect(record).to.have.property(lookupKey, lookupKeyValue);
      });
    });
  });

  context('given some records with different lookup keys have been created', () => {
    let redisRecord: RedisRecord;
    const recordName = nanoid(10);
    const lookupKey = nanoid(10);
    const createdRecords: CreatedRecord[] = [];
    const values = [1, 2].map((number) => ({
      email: `${number}${nanoid()}`,
      [lookupKey]: `lookup${RedisRecord.delimiter}${nanoid()}`
    }));

    before(async () => {
      const redisRecordConfig = { redisClient, name: recordName, lookupKeys: [lookupKey] };
      redisRecord = new RedisRecord(redisRecordConfig);
      createdRecords.push(await redisRecord.createOne(values[0]));
      createdRecords.push(await redisRecord.createOne(values[0]));
      createdRecords.push(await redisRecord.createOne(values[1]));
    });

    after(() => {
      return redisRecord.deleteAll();
    });

    context('when findOneByLookupKey is called with an look up key value that exists in db', () => {
      let record: Record<string, string> | undefined;

      before(async () => {
        // eslint-disable-next-line security/detect-object-injection
        record = await redisRecord.findOneByLookupKey(lookupKey, values[0][lookupKey]);
      });

      it('should find the latest record with this key', () => {
        expect(record).to.have.property('id', createdRecords[1].id);
      });
    });

    context('when findOneByLookupKey is called with an look up key value that is not in db', () => {
      let record: Record<string, string> | undefined;

      before(async () => {
        record = await redisRecord.findOneByLookupKey(lookupKey, nanoid());
      });

      it('should find the latest record with this key', () => {
        expect(record).to.be.undefined;
      });
    });

    // context('when findAllByLookupKey is called with an look up key value that exists in db', () => {
    //   let records: Record<string, string>[];

    //   before(async () => {
    //     // eslint-disable-next-line security/detect-object-injection
    //     records = await redisRecord.findAllByLookupKey(lookupKey, values[0][lookupKey]);
    //   });

    //   it('should find the latest record with this key', () => {
    //     expect(records).to.have.lengthOf(2);
    //     expect(records[0]).to.have.property('id', createdRecords[0].id);
    //     expect(records[1]).to.have.property('id', createdRecords[1].id);
    //   });
    // });
  });

  context('given some records with the same lookup key have been created', () => {});
  context('given some records with the multiple lookup key have been created', () => {});
  context('given some records have been created', () => {
    context('when creating a new record with the same primary key values', () => {
      it('should throw error');
    });
  });

  //
});
