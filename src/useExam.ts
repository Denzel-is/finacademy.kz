import { useEffect, useRef, useState, useCallback } from 'react';
import { api, ApiError } from './api';
import { readCache, writeCache, clearCache, type ExamCache } from './exam-cache';
import { FocusEpisodes } from '../shared/proctor';
import { reconcileDraft, draftFromServer, syncAction, SAVE_DELAY_MS, IDLE_HEARTBEAT_MS, type AnswerConflict } from '../shared/exam-sync';
import type { Answers, Attempt, ProctorEvent } from '../shared/types';

type Recovery = {server: Attempt; answers: Answers; events: ProctorEvent[]; conflicts: AnswerConflict[]};
export function useExam(initial: Attempt, userId: string) {
  const [attempt,setAttempt] = useState(initial), [answers,setAnswers] = useState<Answers>(initial.answers),
    [ready,setReady] = useState(false), [connecting,setConnecting] = useState(!initial.fullscreen),
    [error,setError] = useState(''), [saveState,setSaveState] = useState('saved'),
    [warning,setWarning] = useState(''), [localSafe,setLocalSafe] = useState(true),
    [seconds,setSeconds] = useState<number|null>(null), [recovery,setRecovery] = useState<Recovery|null>(null),
    [unconfirmed,setUnconfirmed] = useState<ExamCache|null>(null),
    [logTruncated,setLogTruncated] = useState(false);
  const clientId=useRef(crypto.randomUUID()), current=useRef(initial),
    cache=useRef<ExamCache>(null!), ack=useRef(initial.version),
    pending=useRef<Promise<void>|null>(null), connectingNow=useRef(false), finishing=useRef(false),
    mounted=useRef(true), armed=useRef(false), autoConnected=useRef(false), position=useRef(''),
    clock=useRef({server:Date.parse(initial.server_now),local:performance.now()}),
    due=useRef(Infinity), heartbeatAt=useRef(0), lastContact=useRef(performance.now()), failures=useRef(0);
  if(!cache.current)cache.current=readCache(userId,initial.id)||draftFromServer(initial,initial.answers);
  const serverNow=()=>clock.current.server+performance.now()-clock.current.local;
  const persist=useCallback(()=>setLocalSafe(writeCache(userId,initial.id,cache.current)),[userId,initial.id]);
  const apply=useCallback((a:Attempt)=>{
    current.current=a; setAttempt(a);
    clock.current={server:Date.parse(a.server_now),local:performance.now()};
    if(a.status!=='active') {
      armed.current=false; setReady(false); setRecovery(null);
      const differs=cache.current.version>ack.current && Object.entries(cache.current.answers).some(([id,value])=>a.answers[id]!==value);
      if(differs) { setUnconfirmed({...cache.current,answers:{...cache.current.answers}}); persist(); }
      else if(cache.current.rejectedEvents?.length)persist();
      else clearCache(userId,a.id);
    }
  },[userId,persist]);
  const schedule=useCallback((delay=SAVE_DELAY_MS)=>{ due.current=Math.min(due.current,performance.now()+delay); },[]);
  const sync=useCallback(async()=>{
    if(pending.current) return pending.current;
    if(current.current.status!=='active'||!armed.current) return;
    const action=syncAction(cache.current.version>ack.current,cache.current.events.length>0&&current.current.proctor_mode!=='off',performance.now(),heartbeatAt.current);
    if(!action) { due.current=Infinity; return; }
    due.current=Infinity;
    const promise=(async()=>{
      if(!navigator.onLine) throw new Error('Нет соединения. Локальные ответы будут отправлены после восстановления связи, если время теста ещё не истекло.');
      const snapshot={...cache.current,answers:{...cache.current.answers},events:[...cache.current.events]};
      setSaveState('saving');
      if(action!=='lease'&&performance.now()-lastContact.current>50000) {
        const restored=await api<Attempt>(`/student/attempts/${initial.id}/lease`,{clientId:clientId.current,compact:true});
        if(restored.status!=='active'){apply(restored);return;}
        if(restored.version!==ack.current||restored.proctor_epoch!==snapshot.epoch)throw new ApiError('Ответы изменились во время отсутствия связи. Подключитесь заново для сравнения.',409);
      }
      if(action==='save') {
        const response=await api(`/student/attempts/${initial.id}/save`,{clientId:clientId.current,version:snapshot.version,answers:snapshot.answers});
        if(response.attempt) { apply(response.attempt); return; }
        if(response.version!==snapshot.version) throw new ApiError('Ответы изменились в другой вкладке. Подключитесь заново.',409);
        ack.current=snapshot.version;
        cache.current.baseVersion=snapshot.version;
        cache.current.baseAnswers=snapshot.answers;
        persist();
      }
      if(action==='lease') {
        const response=await api<Attempt>(`/student/attempts/${initial.id}/lease`,{clientId:clientId.current,compact:true});
        if(response.status!=='active') { apply(response); return; }
        if(response.proctor_epoch!==cache.current.epoch||response.version!==ack.current) throw new ApiError('Попытка изменилась. Подключитесь заново для сравнения ответов.',409);
        if(response.server_now) clock.current={server:Date.parse(response.server_now),local:performance.now()};
      }
      if(snapshot.events.length&&current.current.proctor_mode!=='off') {
        const batch=snapshot.events.slice(0,50);
        const response=await api(`/student/attempts/${initial.id}/events`,{clientId:clientId.current,epoch:snapshot.epoch,events:batch});
        if(response.stale) throw new ApiError('Администратор изменил попытку. Подключитесь заново.',409);
        const rejected=new Set<string>(response.rejected_event_ids||[]);
        if(response.log_truncated){cache.current.logTruncated=true;setLogTruncated(true);}
        if(rejected.size){
          const local=new Map((cache.current.rejectedEvents||[]).map(e=>[e.id,e]));
          for(const event of cache.current.events)if(rejected.has(event.id))local.set(event.id,event);
          cache.current.rejectedEvents=[...local.values()];
        }
        const accepted=new Set<string>(response.accepted_event_ids||batch.map(e=>e.id));
        cache.current.events=cache.current.events.filter(event=>!rejected.has(event.id)&&!batch.some(sent=>accepted.has(sent.id)&&sent.id===event.id&&sent.returnedAt===event.returnedAt&&sent.durationMs===event.durationMs));
        persist();
        if(response.attempt) { apply(response.attempt); return; }
        if(typeof response.violation_count==='number') {
          current.current={...current.current,violation_count:response.violation_count};
          setAttempt(current.current);
        }
      }
      lastContact.current=performance.now();
      heartbeatAt.current=lastContact.current+IDLE_HEARTBEAT_MS+Math.random()*5000;
      failures.current=0;
      const dirty=cache.current.version>ack.current||cache.current.events.length>0;
      if(dirty) schedule();
      if(mounted.current) {setSaveState(dirty?'pending':'saved');setError('');}
    })().catch(e=>{
      failures.current++;
      due.current=performance.now()+Math.min(30000,5000*2**Math.min(failures.current-1,3));
      if(mounted.current) {
        setSaveState(navigator.onLine?'error':'offline'); setError(e.message);
        if(e instanceof ApiError&&[401,403,409].includes(e.status)) {armed.current=false;setReady(false);}
      }
      throw e;
    }).finally(()=>{pending.current=null;});
    pending.current=promise; return promise;
  },[initial.id,apply,persist,schedule]);
  async function activate(a:Attempt, values:Answers, events:ProctorEvent[]) {
    const rejectedEvents=cache.current.rejectedEvents||[],truncated=cache.current.logTruncated||false;
    cache.current={...draftFromServer(a,values,events),rejectedEvents,logTruncated:truncated}; ack.current=a.version;
    setLogTruncated(truncated);
    setAnswers({...values});persist();armed.current=true;setReady(true);setRecovery(null);
    lastContact.current=performance.now();
    heartbeatAt.current=lastContact.current+IDLE_HEARTBEAT_MS+Math.random()*5000;
    if(a.proctor_mode!=='off') cache.current.events.push({id:crypto.randomUUID(),kind:'reload',occurredAt:new Date().toISOString()});
    persist(); setSaveState(cache.current.version>ack.current||cache.current.events.length?'pending':'saved');
    schedule(0); await sync();
  }
  async function connect(force=false) {
    if(connectingNow.current) return;
    connectingNow.current=true;setConnecting(true);setError('');armed.current=false;setReady(false);
    try {
      if(pending.current)await pending.current.catch(()=>{});
      if(initial.fullscreen&&!document.fullscreenElement) {
        if(!document.fullscreenEnabled) throw new Error('Для этого теста нужен полноэкранный режим. Откройте его на компьютере в Chrome, Edge или Firefox.');
        await document.documentElement.requestFullscreen();
      }
      // Only an explicit user action may take over an active tab.
      const a=await api<Attempt>(`/student/attempts/${initial.id}/lease`,{clientId:clientId.current,force});
      if(!mounted.current)return;
      apply(a); if(a.status!=='active') return;
      const restored=reconcileDraft(cache.current,a);
      if(restored.conflicts.length) {armed.current=false;setReady(false);setRecovery({server:a,...restored});return;}
      await activate(a,restored.answers,restored.events);
    } catch(e) {setError((e as Error).message);} finally {connectingNow.current=false;setConnecting(false);}
  }
  async function recover(choices:Record<string,'local'|'server'>) {
    if(!recovery||connectingNow.current) return;
    setConnecting(true);connectingNow.current=true;
    try {
      const a=await api<Attempt>(`/student/attempts/${initial.id}/lease`,{clientId:clientId.current});
      apply(a);if(a.status!=='active')return;
      if(a.version!==recovery.server.version||a.proctor_epoch!==recovery.server.proctor_epoch) {
        const changed=reconcileDraft(cache.current,a);
        if(changed.conflicts.length){setRecovery({server:a,...changed});throw new Error('Ответы на сервере изменились. Проверьте выбор ещё раз.');}
        await activate(a,changed.answers,changed.events);return;
      }
      const merged={...recovery.answers};
      for(const conflict of recovery.conflicts) if(choices[conflict.id]==='local') merged[conflict.id]=conflict.local;
      await activate(a,merged,recovery.events);
    } catch(e) {setError((e as Error).message);}finally {connectingNow.current=false;setConnecting(false);}
  }
  function answer(question:string,option:string) {
    if(!armed.current||finishing.current||current.current.status!=='active'||(current.current.deadline&&Date.parse(current.current.deadline)<=serverNow()))return;
    if(cache.current.answers[question]===option)return;
    cache.current.answers={...cache.current.answers,[question]:option};cache.current.version++;
    setAnswers(cache.current.answers);persist();setSaveState('pending');
    const urgent=current.current.deadline&&Date.parse(current.current.deadline)-serverNow()<20000;
    schedule(urgent?0:SAVE_DELAY_MS+Math.random()*400);
    if(urgent) void sync().catch(()=>{});
  }
  async function finish() {
    if(finishing.current)return;
    finishing.current=true;
    try {
      if(!armed.current) {const a=await api<Attempt>(`/student/attempts/${initial.id}`);apply(a);if(a.status==='active')throw new Error('Подключитесь к попытке перед завершением.');return;}
      // Drain every queued event before grading; one batch is not enough after
      // a long disconnection. Each ID is idempotent on the server.
      for(let i=0;i<25;i++) {
        await sync();
        if(current.current.status!=='active')return;
        if(cache.current.version<=ack.current&&!cache.current.events.length)break;
        if(i===24)throw new Error('Дождитесь отправки журнала событий и повторите завершение.');
      }
      const a=await api<Attempt>(`/student/attempts/${initial.id}/finish`,{clientId:clientId.current,version:cache.current.version,answers:cache.current.answers});
      apply(a);
      if(document.fullscreenElement)await document.exitFullscreen().catch(()=>{});
    }finally {finishing.current=false;}
  }
  const flushBeforeExit=useCallback(async()=>{
    if(current.current.status!=='active')return;
    if(finishing.current)throw new Error('Дождитесь окончания сохранения или завершения теста.');
    if(!armed.current) {
      if(cache.current.version>ack.current)throw new Error('Сначала восстановите и сохраните ответы в текущей вкладке.');
      return;
    }
    finishing.current=true;
    try {
      for(let i=0;i<25;i++) {
        await sync();
        if(current.current.status!=='active'||(cache.current.version<=ack.current&&!cache.current.events.length))return;
      }
      throw new Error('Ответы ещё отправляются. Дождитесь сохранения перед выходом.');
    }finally {finishing.current=false;}
  },[sync]);
  useEffect(()=>{
    mounted.current=true;
    const emit=(event:ProctorEvent)=>{
      if(!armed.current||current.current.proctor_mode==='off'||current.current.status!=='active')return;
      const enriched={...event,questionCode:position.current};
      const rejectedIndex=cache.current.rejectedEvents?.findIndex(e=>e.id===event.id)??-1;
      if(rejectedIndex>=0){cache.current.rejectedEvents![rejectedIndex]=enriched;persist();return;}
      const index=cache.current.events.findIndex(e=>e.id===event.id);
      if(index>=0)cache.current.events[index]=enriched;else cache.current.events.push(enriched);
      persist();schedule();
      if(!event.returnedAt&&['focus','hidden','fullscreen'].includes(event.kind)&&['warn','block'].includes(current.current.proctor_mode)) {
        setWarning(current.current.proctor_mode==='block'?`Зафиксирован уход из теста. При ${current.current.proctor_limit} уходах попытка будет заблокирована.`:'Зафиксирован уход из окна теста. Событие будет доступно администратору.');
        schedule(0);void sync().catch(()=>{});
      }
    };
    const episodes=new FocusEpisodes(emit,()=>crypto.randomUUID(),()=>Date.now());
    const watch=(kind:'focus'|'hidden'|'fullscreen')=>{
      if(!armed.current)return;
      const inside=document.hasFocus()&&document.visibilityState==='visible'&&(!current.current.fullscreen||Boolean(document.fullscreenElement));
      episodes.change(kind,inside);
      if(kind==='fullscreen'&&current.current.fullscreen&&!document.fullscreenElement)setReady(false);
    };
    const hide=()=>{
      if(current.current.status!=='active')return;
      persist();
      if(armed.current&&cache.current.version>ack.current)void fetch(`/api/student/attempts/${initial.id}/save`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId:clientId.current,version:cache.current.version,answers:cache.current.answers}),keepalive:true}).catch(()=>{});
    };
    const blur=()=>watch('focus'),focus=()=>{watch('focus');schedule(0);void sync().catch(()=>{});},
      visible=()=>{watch('hidden');if(document.visibilityState==='hidden')hide();},fullscreen=()=>watch('fullscreen'),
      offline=()=>{setSaveState('offline');emit({id:crypto.randomUUID(),kind:'offline',occurredAt:new Date().toISOString()});},
      online=()=>{schedule(0);void sync().catch(()=>{});},
      beforeUnload=(event:BeforeUnloadEvent)=>{if(current.current.status==='active'&&(cache.current.version>ack.current||cache.current.events.length)){persist();event.preventDefault();event.returnValue='';}};
    const tick=window.setInterval(()=>{
      const remaining=current.current.deadline?Math.max(0,Math.ceil((Date.parse(current.current.deadline)-serverNow())/1000)):null;
      setSeconds(remaining);
      if(armed.current&&!pending.current&&(performance.now()>=due.current||(!failures.current&&performance.now()>=heartbeatAt.current)))void sync().catch(()=>{});
    },1000);
    window.addEventListener('blur',blur);window.addEventListener('focus',focus);
    document.addEventListener('visibilitychange',visible);document.addEventListener('fullscreenchange',fullscreen);
    window.addEventListener('offline',offline);window.addEventListener('online',online);
    window.addEventListener('pagehide',hide);window.addEventListener('beforeunload',beforeUnload);
    return()=>{
      mounted.current=false;hide();armed.current=false;clearInterval(tick);
      window.removeEventListener('blur',blur);window.removeEventListener('focus',focus);
      document.removeEventListener('visibilitychange',visible);document.removeEventListener('fullscreenchange',fullscreen);
      window.removeEventListener('offline',offline);window.removeEventListener('online',online);
      window.removeEventListener('pagehide',hide);window.removeEventListener('beforeunload',beforeUnload);
      // Do not release the lease before an outstanding final save has completed.
      // It expires naturally after 60 seconds; explicit reconnect is available.
    };
  },[initial.id,persist,sync,schedule]);
  useEffect(()=>{if(!initial.fullscreen&&!autoConnected.current){autoConnected.current=true;void connect();}},[initial.id]);
  useEffect(()=>{if(seconds===0&&current.current.status==='active')void finish().catch(e=>setError(e.message));},[seconds]);
  return {attempt,ready:ready&&seconds!==0,connecting,answers,seconds,saveState,error,warning,localSafe,recovery,unconfirmed,logTruncated,rejectedEvents:cache.current.rejectedEvents||[],connect,recover,answer,sync,finish,flushBeforeExit,clearWarning:()=>setWarning(''),setPosition:(id:string)=>{position.current=id;}};
}
