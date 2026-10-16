import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {PostgresDatabase,databasePool} from '../server/database.ts';

test('Failed rollback discards the connection and preserves the write error',async()=>{
  const original=Object.assign(new Error('write failed'),{code:'08006'});
  const released:boolean[]=[];
  const client={async query(query:string){
    if(query==='ROLLBACK')throw Object.assign(new Error('connection closed'),{code:'08006'});
    if(query.startsWith('INSERT'))throw original;
    return {rows:[],rowCount:0};
  },release(discard:boolean){released.push(discard);}};
  const pool={async connect(){return client;},async query(){throw new Error('unexpected query');}};
  const log=mock.method(console,'error',()=>{});
  try {
    const db=new PostgresDatabase(pool as any);
    await assert.rejects(db.prepare('INSERT INTO attempts(id) VALUES(?)').bind('fixture').run(),error=>error===original);
    assert.deepEqual(released,[true]);
    assert.equal(log.mock.callCount(),1);
  }finally{log.mock.restore();}
});

test('Serialization failure rolls back and retries the whole transaction',async()=>{
  let writes=0,rollbacks=0,commits=0;
  const released:boolean[]=[];
  const client={async query(query:string){
    if(query==='ROLLBACK'){rollbacks++;return {rows:[],rowCount:0};}
    if(query==='COMMIT'){commits++;return {rows:[],rowCount:0};}
    if(query.startsWith('UPDATE')&&++writes===1)throw Object.assign(new Error('serialization failure'),{code:'40001'});
    return {rows:[],rowCount:1};
  },release(discard:boolean){released.push(discard);}};
  const pool={async connect(){return client;},async query(){throw new Error('unexpected query');}};
  const db=new PostgresDatabase(pool as any);
  await db.batch([db.prepare('UPDATE attempts SET version=? WHERE id=?').bind(2,'fixture')]);
  assert.equal(writes,2);assert.equal(rollbacks,1);assert.equal(commits,1);assert.deepEqual(released,[false,false]);
});

test('Idle PostgreSQL connection errors have a listener and do not expose query contents',async()=>{
  const pool=databasePool();
  const log=mock.method(console,'error',()=>{});
  try {
    assert.equal(pool.listenerCount('error'),1);
    assert.doesNotThrow(()=>pool.emit('error',Object.assign(new Error('secret query text'),{code:'08006'})));
    assert.deepEqual(log.mock.calls[0].arguments,['Idle database connection failed','08006']);
  }finally{log.mock.restore();await pool.end();}
});
