# Redis Record

query redis by primary key, look up key

```javascript
import IORedis from 'ioredis';
import { RedisRecord } from 'src/redis-record';

const redisRecord = new RedisRecord({
  redisClient: new IORedis(),
  name: 'user',
  lookupKeys: ['groupId']
});

const { id } = await redisRecord.createOne({ username: 'abc', groupId: '1'});
const user2 = await redisRecord.createOne({ username: 'xyz', groupId: '2'});

const { id, username, groupId } = await redisRecord.findById(id);

const users = await redisRecord.findAll(); //  [{ username: 'abc', groupId: '1' }, { username: 'xyz', groupId: '2' }]

const group1Users = await redisRecord.findOneByLookupKey('groupId', '2'); // [ { username: 'xyz', groupId: '2' } ]

await credisRecord.deleteAll(); // redis-cli > keys * > (empty list or set)
```