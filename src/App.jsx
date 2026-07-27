import { useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'
import { addDoc, collection, deleteDoc, doc, getDoc, onSnapshot, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore'
import { auth, db, googleProvider } from './firebase.js'

const PARTS = ['胸','背中','肩','腕','脚','腹']
const DEFAULTS = {
  胸:['ベンチプレス','インクラインダンベルプレス','チェストプレス','ペックデック','ダンベルフライ','ケーブルフライ','ディップス','プッシュアップ','マルチプレス'],
  背中:['ラットプルダウン','シーテッドロー','ワンハンドロー','懸垂','ベントオーバーロー','Tバーロー','ストレートアームプルダウン','フェイスプル'],
  肩:['ショルダープレス','サイドレイズ','フロントレイズ','リアデルト','アップライトロー','アーノルドプレス'],
  腕:['ダンベルカール','ハンマーカール','プレスダウン','フレンチプレス','バーベルカール','プリーチャーカール','オーバーヘッドロープエクステンション'],
  脚:['スクワット','レッグプレス','レッグカール','レッグエクステンション','ブルガリアンスクワット','ルーマニアンデッドリフト','カーフレイズ'],
  腹:['クランチ','アブドミナル','レッグレイズ','プランク','デクラインシットアップ','アブローラー'],
}
const CARDIO_DEFAULTS = ['ランニング','ウォーキング','バイク']
const blankSet = (weight='') => ({weight, reps:'', effort:'普通'})
const normalizeName = value => String(value||'').trim().toLowerCase()
const volumeOf = exercises => (exercises||[]).reduce((t,e)=>t+(e.sets||[]).reduce((s,x)=>s+Number(x.weight||0)*Number(x.reps||0),0),0)
const setCountOf = exercises => (exercises||[]).reduce((t,e)=>t+(e.sets||[]).length,0)
const estimateStrengthCalories = exercises => Math.round(setCountOf(exercises)*8)
const estimateCardioCalories = item => Number(item.calories||0) || Math.round(Number(item.minutes||0)*7)
const dateKey=(value=new Date())=>{const d=new Date(value);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
const inferPart=(name,fallback='胸')=>{for(const p of PARTS){if((DEFAULTS[p]||[]).some(x=>normalizeName(x)===normalizeName(name)))return p}return PARTS.includes(fallback)?fallback:'胸'}
const mergeExercises=(a=[],b=[])=>{const m=new Map(a.map(e=>[`${e.part||inferPart(e.name)}|${normalizeName(e.name)}`,{...e,part:e.part||inferPart(e.name)}]));b.forEach(e=>{const item={...e,part:e.part||inferPart(e.name)};const k=`${item.part}|${normalizeName(item.name)}`;const old=m.get(k);m.set(k,old?{...old,sets:[...(old.sets||[]),...(item.sets||[])]}:item)});return [...m.values()]}
const compressSets=(sets=[])=>{const out=[];for(const s of sets){const last=out.at(-1);const same=last&&Number(last.weight||0)===Number(s.weight||0)&&Number(last.reps||0)===Number(s.reps||0)&&(last.effort||'普通')===(s.effort||'普通');if(same)last.count+=1;else out.push({...s,count:1})}return out}
const groupByDay=(workouts=[])=>{const m=new Map();for(const w of workouts){const k=w.dateKey||dateKey(w.startedAt);const fallback=PARTS.includes(w.title)?w.title:'胸';const ex=(w.exercises||[]).map(e=>({...e,part:e.part||inferPart(e.name,fallback)}));const old=m.get(k)||{id:k,dateKey:k,sourceIds:[],startedAt:w.startedAt,title:'',memo:'',exercises:[],cardio:[]};old.sourceIds.push(w.id);old.startedAt=old.startedAt||w.startedAt;old.memo=[old.memo,w.memo].filter(Boolean).join('\n');old.exercises=mergeExercises(old.exercises,ex);old.cardio=[...(old.cardio||[]),...(w.cardio||[])];m.set(k,old)}return [...m.values()].map(w=>({...w,volume:volumeOf(w.exercises),estimatedCalories:estimateStrengthCalories(w.exercises)+(w.cardio||[]).reduce((s,x)=>s+estimateCardioCalories(x),0)})).sort((a,b)=>new Date(b.startedAt)-new Date(a.startedAt))}

export default function App(){
  const [user,setUser]=useState(null), [ready,setReady]=useState(false), [screen,setScreen]=useState('home')
  const [routines,setRoutines]=useState([]), [workouts,setWorkouts]=useState([]), [custom,setCustom]=useState({}), [hidden,setHidden]=useState({})
  const [part,setPart]=useState(''), [draft,setDraft]=useState(null), [loginError,setLoginError]=useState(''), [editing,setEditing]=useState(null)
  const [timer,setTimer]=useState(null), [timerNow,setTimerNow]=useState(Date.now())
  const groupedWorkouts=useMemo(()=>groupByDay(workouts),[workouts])

  useEffect(()=>onAuthStateChanged(auth, async u=>{setUser(u);setReady(true);if(u)await setDoc(doc(db,'users',u.uid),{displayName:u.displayName||'',email:u.email||'',updatedAt:serverTimestamp()},{merge:true})}),[])
  useEffect(()=>{
    if(!user)return
    const ur=onSnapshot(query(collection(db,'users',user.uid,'routines'),orderBy('createdAt','desc')),s=>setRoutines(s.docs.map(d=>({id:d.id,...d.data()}))))
    const uw=onSnapshot(query(collection(db,'users',user.uid,'workouts'),orderBy('startedAt','desc')),s=>setWorkouts(s.docs.map(d=>({id:d.id,...d.data()}))))
    const uc=onSnapshot(doc(db,'users',user.uid,'settings','customExercises'),s=>{const data=s.exists()?s.data():{};setCustom(data.parts||{});setHidden(data.hidden||{})})
    return()=>{ur();uw();uc()}
  },[user])
  useEffect(()=>{
    if(!timer)return
    const tick=()=>{const now=Date.now();setTimerNow(now);if(now>=timer.endsAt)setTimer(null)}
    tick();const id=setInterval(tick,250);return()=>clearInterval(id)
  },[timer])

  const startTimer=(seconds,label)=>{if(!seconds)return;setTimer({seconds,label,endsAt:Date.now()+seconds*1000});setTimerNow(Date.now())}
  if(!ready)return <div className="center">読み込み中…</div>
  if(!user)return <Login onLogin={async()=>{try{setLoginError('');await signInWithPopup(auth,googleProvider)}catch(e){setLoginError(e.message)}}} error={loginError}/>

  const goHome=()=>{setScreen('home');setDraft(null);setPart('')}
  const saveRoutine=async(title,exercises)=>addDoc(collection(db,'users',user.uid,'routines'),{title,exercises,createdAt:serverTimestamp()})
  const upsertDaily=async patch=>{
    const id=patch.dateKey||dateKey(patch.startedAt)
    const ref=doc(db,'users',user.uid,'workouts',id)
    const snap=await getDoc(ref)
    const old=snap.exists()?snap.data():{}
    const fallback=PARTS.includes(patch.title)?patch.title:part||'胸'
    const incoming=(patch.exercises||[]).map(e=>({...e,part:e.part||inferPart(e.name,fallback)}))
    const oldExercises=(old.exercises||[]).map(e=>({...e,part:e.part||inferPart(e.name,PARTS.includes(old.title)?old.title:'胸')}))
    const exercises=mergeExercises(oldExercises,incoming)
    const cardio=[...(old.cardio||[]),...(patch.cardio||[])]
    await setDoc(ref,{
      dateKey:id,
      startedAt:old.startedAt||patch.startedAt||new Date().toISOString(),
      endedAt:patch.endedAt||new Date().toISOString(),
      memo:[old.memo,patch.memo].filter(Boolean).join('\n'),
      exercises,
      cardio,
      volume:volumeOf(exercises),
      estimatedCalories:estimateStrengthCalories(exercises)+cardio.reduce((s,x)=>s+estimateCardioCalories(x),0),
      updatedAt:serverTimestamp(),
      ...(snap.exists()?{}:{createdAt:serverTimestamp()})
    },{merge:true})
  }
  const saveWorkout=async workout=>{await upsertDaily(workout)}
  const saveCardio=async item=>{await upsertDaily({startedAt:new Date().toISOString(),cardio:[item]});alert('今日の有酸素に追加しました');goHome()}
  const addCustom=async name=>{
    const trimmed=name.trim();if(!trimmed)return null
    const all=[...(DEFAULTS[part]||[]),...(custom[part]||[])]
    const existing=all.find(x=>normalizeName(x)===normalizeName(trimmed))
    if(existing)return existing
    const next={...custom,[part]:[...(custom[part]||[]),trimmed]}
    await setDoc(doc(db,'users',user.uid,'settings','customExercises'),{parts:next,hidden,updatedAt:serverTimestamp()},{merge:true})
    return trimmed
  }
  const deleteCustom=async name=>{const next={...custom,[part]:(custom[part]||[]).filter(x=>x!==name)};await setDoc(doc(db,'users',user.uid,'settings','customExercises'),{parts:next,hidden,updatedAt:serverTimestamp()},{merge:true})}
  const hideDefault=async name=>{const next={...hidden,[part]:[...new Set([...(hidden[part]||[]),name])]};await setDoc(doc(db,'users',user.uid,'settings','customExercises'),{parts:custom,hidden:next,updatedAt:serverTimestamp()},{merge:true})}
  const restoreDefault=async name=>{const next={...hidden,[part]:(hidden[part]||[]).filter(x=>x!==name)};await setDoc(doc(db,'users',user.uid,'settings','customExercises'),{parts:custom,hidden:next,updatedAt:serverTimestamp()},{merge:true})}
  const saveEdit=async w=>{const canonical=w.dateKey||dateKey(w.startedAt);await setDoc(doc(db,'users',user.uid,'workouts',canonical),{...w,dateKey:canonical,volume:volumeOf(w.exercises),estimatedCalories:estimateStrengthCalories(w.exercises)+(w.cardio||[]).reduce((s,x)=>s+estimateCardioCalories(x),0),editedAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});for(const id of (w.sourceIds||[w.id]))if(id!==canonical)await deleteDoc(doc(db,'users',user.uid,'workouts',id));setEditing(null);setScreen('history')}

  let body
  if(screen==='start') body=<Start routines={routines} onBack={goHome} onRoutine={r=>{setDraft({title:r.title,names:r.exercises,mode:'routine'});setScreen('routineSession')}} onPart={p=>{setPart(p);setScreen('pick')}}/>
  else if(screen==='pick') body=<Picker part={part} names={[...(DEFAULTS[part]||[]).filter(x=>!(hidden[part]||[]).includes(x)),...(custom[part]||[])]} defaults={DEFAULTS[part]||[]} hiddenDefaults={hidden[part]||[]} doneNames={(groupedWorkouts.find(w=>w.dateKey===dateKey())?.exercises||[]).filter(e=>e.part===part).map(e=>e.name)} recentNames={[...new Set(groupedWorkouts.flatMap(w=>w.exercises||[]).filter(e=>e.part===part).map(e=>e.name))].slice(0,5)} onBack={()=>setScreen('start')} onAdd={addCustom} onDelete={deleteCustom} onHide={hideDefault} onRestore={restoreDefault} onPick={name=>{setDraft({title:part,names:[name],mode:'quick'});setScreen('workout')}}/>
  else if(screen==='workout') body=<QuickWorkout title={draft.title} name={draft.names[0]} history={groupedWorkouts} onBack={()=>setScreen('pick')} onSave={saveWorkout} onStartTimer={startTimer}/>
  else if(screen==='routineSession') body=<RoutineSession title={draft.title} names={draft.names} history={groupedWorkouts} onBack={()=>setScreen('start')} onSave={saveWorkout} onStartTimer={startTimer} onFinish={goHome}/>
  else if(screen==='cardio') body=<Cardio onBack={goHome} onSave={saveCardio}/>
  else if(screen==='routines') body=<Routines routines={routines} onBack={goHome} onSave={saveRoutine} onDelete={async id=>{if(confirm('削除しますか？'))await deleteDoc(doc(db,'users',user.uid,'routines',id))}}/>
  else if(screen==='edit') body=<EditWorkout workout={editing} onBack={()=>setScreen('history')} onSave={saveEdit}/>
  else if(screen==='history') body=<History workouts={groupedWorkouts} onBack={goHome} onEdit={w=>{setEditing(w);setScreen('edit')}} onDelete={async w=>{if(!confirm(`${w.dateKey}の記録をすべて削除しますか？`))return;for(const id of (w.sourceIds||[w.id]))await deleteDoc(doc(db,'users',user.uid,'workouts',id))}}/>
  else body=<Home onStart={()=>setScreen('start')} onHistory={()=>setScreen('history')} onRoutines={()=>setScreen('routines')} onCardio={()=>setScreen('cardio')}/>

  const timerLeft=timer?Math.max(0,Math.ceil((timer.endsAt-timerNow)/1000)):0
  return <main className="shell"><header className="top"><button onClick={goHome}>BulkBro</button><div><span>{user.displayName}</span><button onClick={()=>signOut(auth)}>ログアウト</button></div></header>{timer&&<div className="floating-timer"><div><small>休憩中 {timer.label||''}</small><strong>{String(Math.floor(timerLeft/60)).padStart(2,'0')}:{String(timerLeft%60).padStart(2,'0')}</strong></div><button onClick={()=>setTimer(null)}>終了</button></div>}{body}</main>
}

function Login({onLogin,error}){return <div className="center"><section className="login"><p className="eyebrow">TRAINING LOG</p><h1>BulkBro</h1><p className="muted">さらに、その先へ。</p><button className="primary" onClick={onLogin}>Googleでログイン</button>{error&&<p className="error">{error}</p>}</section></div>}
function Home({onStart,onHistory,onRoutines,onCardio}){return <section className="home"><div><p className="eyebrow">TRAINING LOG</p><h1>BulkBro</h1><p className="muted">さらに、その先へ。</p></div><div className="stack"><button className="primary" onClick={onStart}>🏋️ クイック入力</button><button onClick={onRoutines}>📋 ルーティン</button><button onClick={onCardio}>🏃 有酸素</button><button onClick={onHistory}>📊 Training Log</button></div></section>}
function Start({routines,onBack,onRoutine,onPart}){return <section><Back onClick={onBack}/><Head eyebrow="START WORKOUT" title="トレーニング開始"/>{routines.length>0&&<><h2>保存済みルーティン</h2><div className="stack">{routines.map(r=><button className="routine" key={r.id} onClick={()=>onRoutine(r)}><strong>{r.title}</strong><span>{r.exercises.length}種目</span></button>)}</div></>}<h2 className="space">部位から選ぶ</h2><div className="grid">{PARTS.map(p=><button className="part" key={p} onClick={()=>onPart(p)}>{p}</button>)}</div></section>}

function Picker({part,names,defaults,hiddenDefaults,doneNames,recentNames,onBack,onAdd,onDelete,onHide,onRestore,onPick}){
  const [name,setName]=useState(''),[showHidden,setShowHidden]=useState(false)
  const search=name.trim().toLowerCase()
  const filtered=names.filter(x=>!search||x.toLowerCase().includes(search))
  const recent=(recentNames||[]).filter(x=>names.includes(x)).filter(x=>!search||x.toLowerCase().includes(search))
  const submit=async e=>{e.preventDefault();const resolved=await onAdd(name);if(!resolved)return;setName('');onPick(resolved)}
  return <section><Back onClick={onBack}/><Head eyebrow="QUICK INPUT" title={part}/><form className="card form" onSubmit={submit}><h2>種目を検索・自由入力</h2><input value={name} onChange={e=>setName(e.target.value)} placeholder="例：マルチプレス"/>{name.trim()&&<button className="primary">「{name.trim()}」で入力する</button>}</form>{recent.length>0&&<><div className="row list-title"><h2>最近使った種目</h2></div><div className="stack">{recent.map(n=><button key={`r-${n}`} className={doneNames.includes(n)?'done-exercise':''} onClick={()=>onPick(n)}>{doneNames.includes(n)?'✓ ':''}{n}</button>)}</div></>}<div className="row list-title"><h2>種目一覧</h2><small>{doneNames.length}種目記録済み</small></div><div className="stack">{filtered.map(n=>{const isDefault=defaults.includes(n),done=doneNames.includes(n);return <div className="custom-row" key={n}><button className={done?'done-exercise':''} onClick={()=>onPick(n)}>{done?'✓ ':''}{n}</button><button type="button" className="danger" onClick={()=>confirm(`「${n}」を一覧から削除しますか？\n過去の記録は残ります。`)&&(isDefault?onHide(n):onDelete(n))}>×</button></div>})}</div>{!filtered.length&&<div className="empty">一致する種目がありません。上のボタンからその名前で入力できます。</div>}{hiddenDefaults.length>0&&<article className="card"><button type="button" className="hidden-toggle" onClick={()=>setShowHidden(x=>!x)}>{showHidden?'閉じる':'非表示にした種目を管理'}</button>{showHidden&&<div className="stack hidden-list">{hiddenDefaults.map(n=><button key={n} onClick={()=>onRestore(n)}>{n}を復元</button>)}</div>}</article>}</section>
}

function TimerControl({name,onStart}){const [seconds,setSeconds]=useState(60);return <div className="timer-setting"><label>⏱ 休憩タイマー<select value={seconds} onChange={e=>setSeconds(Number(e.target.value))}><option value={30}>30秒</option><option value={60}>1分</option><option value={90}>1分30秒</option><option value={120}>2分</option><option value={180}>3分</option><option value={300}>5分</option></select></label><button type="button" className="small" onClick={()=>onStart(seconds,name)}>▶ START</button></div>}

function latestPrevious(history,name,currentDay){for(const w of history){if(w.dateKey===currentDay)continue;const e=w.exercises?.find(x=>normalizeName(x.name)===normalizeName(name));if(e)return e}return null}
function bestWeight(history,name){return Math.max(0,...history.flatMap(w=>w.exercises?.filter(e=>normalizeName(e.name)===normalizeName(name)).flatMap(e=>e.sets.map(s=>Number(s.weight||0)))||[]))}

function QuickWorkout({title,name,history,onBack,onSave,onStartTimer}){
  const currentDay=dateKey();const prev=latestPrevious(history,name,currentDay);const pr=bestWeight(history,name)
  const [set,setSet]=useState(()=>blankSet(prev?.sets?.at(-1)?.weight??'')),[memo,setMemo]=useState(''),[saving,setSaving]=useState(false),[savedCount,setSavedCount]=useState(0)
  const save=async()=>{if(set.weight===''||set.reps==='')return alert('重量と回数を入力');setSaving(true);await onSave({title,startedAt:new Date().toISOString(),endedAt:new Date().toISOString(),memo,exercises:[{name,part:title,sets:[{...set,weight:Number(set.weight),reps:Number(set.reps)}]}]});setSavedCount(x=>x+1);setSet(blankSet(set.weight));setMemo('');setSaving(false)}
  return <section><Back onClick={onBack}/><Head eyebrow="QUICK INPUT" title={name}/><TimerControl name={name} onStart={onStartTimer}/>{pr>0&&<div className="summary"><span>BEST</span><strong>👑 {pr}kg</strong></div>}{prev&&<div className="previous"><small>前回（最新1回分）</small><div className="chips">{prev.sets.map((s,i)=><button key={i} onClick={()=>setSet({weight:String(s.weight),reps:String(s.reps),effort:s.effort||'普通'})}>{s.weight}kg×{s.reps}</button>)}</div></div>}<article className="exercise"><div className="row"><h2>SET {savedCount+1}</h2>{savedCount>0&&<small>{savedCount}セット記録済み</small>}</div><div className="set"><input type="number" step="0.5" value={set.weight} onChange={e=>setSet({...set,weight:e.target.value})} placeholder="kg"/><input type="number" value={set.reps} onChange={e=>setSet({...set,reps:e.target.value})} placeholder="回"/><select value={set.effort} onChange={e=>setSet({...set,effort:e.target.value})}><option>余裕</option><option>普通</option><option>限界</option></select></div></article><label className="memo">メモ<textarea value={memo} onChange={e=>setMemo(e.target.value)}/></label><div className="summary"><span>推定消費カロリー</span><strong>🔥 約8kcal / SET</strong></div><button className="primary" disabled={saving} onClick={save}>{saving?'保存中…':'このSETを記録'}</button><button onClick={onBack}>種目一覧へ戻る</button></section>
}

function RoutineSession({title,names,history,onBack,onSave,onStartTimer,onFinish}){
  const [index,setIndex]=useState(0),[set,setSet]=useState(blankSet()),[counts,setCounts]=useState(()=>Object.fromEntries(names.map(n=>[n,0]))),[saving,setSaving]=useState(false)
  const name=names[index],prev=latestPrevious(history,name,dateKey()),pr=bestWeight(history,name)
  useEffect(()=>{setSet(blankSet(prev?.sets?.at(-1)?.weight??''))},[index])
  const save=async()=>{if(set.weight===''||set.reps==='')return alert('重量と回数を入力');setSaving(true);await onSave({title,startedAt:new Date().toISOString(),endedAt:new Date().toISOString(),exercises:[{name,part:inferPart(name),sets:[{...set,weight:Number(set.weight),reps:Number(set.reps)}]}]});setCounts(c=>({...c,[name]:(c[name]||0)+1}));setSet(blankSet(set.weight));setSaving(false)}
  const next=()=>{if(index<names.length-1)setIndex(index+1);else if(confirm('ルーティンを終了しますか？'))onFinish()}
  return <section><Back onClick={onBack}/><Head eyebrow="ROUTINE SESSION" title={title}/><div className="summary"><span>{index+1}/{names.length}</span><strong>{name}</strong></div><TimerControl name={name} onStart={onStartTimer}/>{pr>0&&<div className="summary"><span>BEST</span><strong>👑 {pr}kg</strong></div>}{prev&&<div className="previous"><small>前回（最新1回分）</small><div className="chips">{prev.sets.map((s,i)=><button key={i} onClick={()=>setSet({weight:String(s.weight),reps:String(s.reps),effort:s.effort||'普通'})}>{s.weight}kg×{s.reps}</button>)}</div></div>}<article className="exercise"><div className="row"><h2>SET {(counts[name]||0)+1}</h2><small>{counts[name]||0}セット完了</small></div><div className="set"><input type="number" step="0.5" value={set.weight} onChange={e=>setSet({...set,weight:e.target.value})} placeholder="kg"/><input type="number" value={set.reps} onChange={e=>setSet({...set,reps:e.target.value})} placeholder="回"/><select value={set.effort} onChange={e=>setSet({...set,effort:e.target.value})}><option>余裕</option><option>普通</option><option>限界</option></select></div></article><button className="primary" disabled={saving} onClick={save}>{saving?'保存中…':'このSETを記録'}</button><button onClick={next}>{index<names.length-1?'種目完了 → 次の種目':'ルーティン終了'}</button><div className="list">{names.map((n,i)=><div className="row card" key={n}><span>{i===index?'▶ ':i<index?'✓ ':''}{n}</span><small>{counts[n]||0} SET</small></div>)}</div></section>
}

function Cardio({onBack,onSave}){const [type,setType]=useState('ランニング'),[custom,setCustom]=useState(''),[minutes,setMinutes]=useState(''),[distance,setDistance]=useState(''),[calories,setCalories]=useState(''),[memo,setMemo]=useState('');const name=type==='自由追加'?custom.trim():type;return <section><Back onClick={onBack}/><Head eyebrow="CARDIO" title="有酸素"/><div className="grid">{[...CARDIO_DEFAULTS,'自由追加'].map(x=><button key={x} className={type===x?'done-exercise':''} onClick={()=>setType(x)}>{x}</button>)}</div>{type==='自由追加'&&<label className="memo">種目名<input value={custom} onChange={e=>setCustom(e.target.value)} placeholder="例：ステアマスター"/></label>}<div className="card form"><label>時間（分）<input type="number" value={minutes} onChange={e=>setMinutes(e.target.value)}/></label><label>距離（km・任意）<input type="number" step="0.1" value={distance} onChange={e=>setDistance(e.target.value)}/></label><label>消費カロリー（任意）<input type="number" value={calories} onChange={e=>setCalories(e.target.value)}/></label><label>メモ<textarea value={memo} onChange={e=>setMemo(e.target.value)}/></label></div><div className="summary"><span>推定消費カロリー</span><strong>🔥 {estimateCardioCalories({minutes,calories})}kcal</strong></div><button className="primary" onClick={()=>{if(!name||!minutes)return alert('種目と時間を入力');onSave({name,minutes:Number(minutes),distance:Number(distance||0),calories:Number(calories||0),memo,createdAt:new Date().toISOString()})}}>今日の有酸素に保存</button></section>}

function Routines({routines,onBack,onSave,onDelete}){const [title,setTitle]=useState(''),[items,setItems]=useState('');return <section><Back onClick={onBack}/><Head eyebrow="MY ROUTINES" title="ルーティン管理"/><form className="card form" onSubmit={async e=>{e.preventDefault();const ex=items.split('\n').map(x=>x.trim()).filter(Boolean);if(!title.trim()||!ex.length)return alert('タイトルと種目を入力');await onSave(title.trim(),ex);setTitle('');setItems('')}}><label>自由タイトル<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="胸ルーティン"/></label><label>種目（1行に1種目）<textarea value={items} onChange={e=>setItems(e.target.value)} placeholder={'ベンチプレス\nサイドレイズ'}/></label><button className="primary">保存</button></form><div className="list">{routines.map(r=><article className="card" key={r.id}><div className="row"><div><h2>{r.title}</h2><small>{r.exercises.length}種目</small></div><button className="danger" onClick={()=>onDelete(r.id)}>×</button></div><ol>{r.exercises.map((x,i)=><li key={`${x}-${i}`}>{x}</li>)}</ol></article>)}</div></section>}

function History({workouts,onBack,onDelete,onEdit}){const [month,setMonth]=useState(()=>new Date()),[selected,setSelected]=useState(()=>dateKey());const first=new Date(month.getFullYear(),month.getMonth(),1),last=new Date(month.getFullYear(),month.getMonth()+1,0),cells=[...Array(first.getDay()).fill(null),...Array.from({length:last.getDate()},(_,i)=>i+1)];const has=new Set(workouts.map(w=>w.dateKey));const shown=workouts.find(w=>w.dateKey===selected);const allBest=(part,name)=>Math.max(0,...workouts.flatMap(w=>w.exercises.filter(e=>e.part===part&&normalizeName(e.name)===normalizeName(name)).flatMap(e=>e.sets.map(s=>Number(s.weight||0)))));return <section><Back onClick={onBack}/><Head eyebrow="WORKOUT HISTORY" title="Training Log"/><div className="calendar"><div className="calhead"><button onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))}>〈</button><strong>{month.getFullYear()}年{month.getMonth()+1}月</strong><button onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))}>〉</button></div><div className="week">{['日','月','火','水','木','金','土'].map(x=><span key={x}>{x}</span>)}</div><div className="calgrid">{cells.map((d,i)=>d?(()=>{const k=dateKey(new Date(month.getFullYear(),month.getMonth(),d));return <button className={`${has.has(k)?'trained':''} ${selected===k?'done-exercise':''}`} key={k} onClick={()=>setSelected(k)}>{d}</button>})():<div key={i}/>)}</div></div>{!shown?<div className="empty">{selected.replaceAll('-','/')} の記録はありません。</div>:<article className="card"><div className="row"><div><h2>{shown.dateKey.replaceAll('-','/')}</h2><small>🔥 推定 {shown.estimatedCalories||0}kcal</small></div><div><button onClick={()=>onEdit(shown)}>編集</button><button className="danger" onClick={()=>onDelete(shown)}>×</button></div></div>{PARTS.filter(p=>shown.exercises.some(e=>e.part===p)).map(p=><section className="hist" key={p}><h3>{p}</h3>{shown.exercises.filter(e=>e.part===p).map(e=>{const own=Math.max(0,...e.sets.map(s=>Number(s.weight||0)));return <div className="history-exercise" key={e.name}><h4>{own>0&&own===allBest(p,e.name)?'👑 ':''}{e.name}</h4><ul>{compressSets(e.sets).map((s,i)=><li key={i}>{s.weight}kg × {s.reps}回{s.count>1?` × ${s.count}セット`:''}</li>)}</ul></div>})}</section>)}{shown.cardio?.length>0&&<section className="hist"><h3>有酸素</h3>{shown.cardio.map((c,i)=><div className="history-exercise" key={`${c.name}-${i}`}><h4>{c.name}</h4><p>{c.minutes}分 {c.distance?`・${c.distance}km`:''} ・🔥{estimateCardioCalories(c)}kcal</p></div>)}</section>}<strong className="total">推定消費カロリー 🔥 {shown.estimatedCalories||0}kcal</strong></article>}</section>}

function EditWorkout({workout,onBack,onSave}){const [exercises,setExercises]=useState((workout.exercises||[]).map(e=>({...e,sets:(e.sets||[]).map(s=>({...s,weight:String(s.weight??''),reps:String(s.reps??''),effort:s.effort||'普通'}))}))),[memo,setMemo]=useState(workout.memo||'');const update=(ei,si,k,v)=>setExercises(cur=>cur.map((e,i)=>i!==ei?e:{...e,sets:e.sets.map((s,j)=>j===si?{...s,[k]:v}:s)}));const removeSet=(ei,si)=>setExercises(cur=>cur.map((e,i)=>i!==ei?e:{...e,sets:e.sets.length===1?[blankSet()]:e.sets.filter((_,j)=>j!==si)}));const save=()=>{const cleaned=exercises.map(e=>({...e,sets:e.sets.filter(s=>s.weight!==''&&s.reps!=='').map(s=>({...s,weight:Number(s.weight),reps:Number(s.reps)}))})).filter(e=>e.sets.length);if(!cleaned.length)return alert('1種目以上残してください');onSave({...workout,memo,exercises:cleaned})};return <section><Back onClick={onBack}/><Head eyebrow="EDIT HISTORY" title="履歴編集"/><div className="list">{exercises.map((e,ei)=><article className="exercise" key={`${e.name}-${ei}`}><div className="row"><h2>{e.name}</h2><button className="danger" onClick={()=>setExercises(cur=>cur.filter((_,i)=>i!==ei))}>種目削除</button></div><div className="sets">{e.sets.map((s,si)=><div className="set" key={si}><small>SET {si+1}</small><input type="number" step="0.5" value={s.weight} onChange={x=>update(ei,si,'weight',x.target.value)} placeholder="kg"/><input type="number" value={s.reps} onChange={x=>update(ei,si,'reps',x.target.value)} placeholder="回"/><select value={s.effort} onChange={x=>update(ei,si,'effort',x.target.value)}><option>余裕</option><option>普通</option><option>限界</option></select><button className="danger" onClick={()=>removeSet(ei,si)}>×</button></div>)}</div><button className="small" onClick={()=>setExercises(cur=>cur.map((x,i)=>i===ei?{...x,sets:[...x.sets,{...(x.sets.at(-1)||blankSet())}]}:x))}>＋ 前セットをコピー</button></article>)}</div><label className="memo">メモ<textarea value={memo} onChange={e=>setMemo(e.target.value)}/></label><button className="primary" onClick={save}>編集を保存</button></section>}
function Back({onClick}){return <button className="back" onClick={onClick}>← 戻る</button>}
function Head({eyebrow,title}){return <header className="heading"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></header>}