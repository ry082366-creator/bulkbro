import { useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore'
import { auth, db, googleProvider } from './firebase.js'

const PARTS = ['胸','背中','肩','腕','脚','腹']
const DEFAULTS = {
  胸:['ベンチプレス','インクラインダンベルプレス','チェストプレス','ペックデック'],
  背中:['ラットプルダウン','シーテッドロー','ワンハンドロー','懸垂'],
  肩:['ショルダープレス','サイドレイズ','フロントレイズ','リアデルト'],
  腕:['ダンベルカール','ハンマーカール','プレスダウン','フレンチプレス'],
  脚:['スクワット','レッグプレス','レッグカール','レッグエクステンション'],
  腹:['クランチ','アブドミナル','レッグレイズ','プランク'],
}
const blankSet = () => ({weight:'', reps:'', effort:'普通'})
const volumeOf = (exercises) => exercises.reduce((t,e)=>t+e.sets.reduce((s,x)=>s+Number(x.weight||0)*Number(x.reps||0),0),0)

export default function App(){
  const [user,setUser]=useState(null), [ready,setReady]=useState(false), [screen,setScreen]=useState('home')
  const [routines,setRoutines]=useState([]), [workouts,setWorkouts]=useState([]), [custom,setCustom]=useState({})
  const [part,setPart]=useState(''), [draft,setDraft]=useState(null), [loginError,setLoginError]=useState('')

  useEffect(()=>onAuthStateChanged(auth, async u=>{setUser(u);setReady(true);if(u)await setDoc(doc(db,'users',u.uid),{displayName:u.displayName||'',email:u.email||'',updatedAt:serverTimestamp()},{merge:true})}),[])
  useEffect(()=>{
    if(!user)return
    const ur=onSnapshot(query(collection(db,'users',user.uid,'routines'),orderBy('createdAt','desc')),s=>setRoutines(s.docs.map(d=>({id:d.id,...d.data()}))))
    const uw=onSnapshot(query(collection(db,'users',user.uid,'workouts'),orderBy('startedAt','desc')),s=>setWorkouts(s.docs.map(d=>({id:d.id,...d.data()}))))
    const uc=onSnapshot(doc(db,'users',user.uid,'settings','customExercises'),s=>setCustom(s.exists()?s.data().parts||{}:{}))
    return()=>{ur();uw();uc()}
  },[user])

  if(!ready)return <div className="center">読み込み中…</div>
  if(!user)return <Login onLogin={async()=>{try{setLoginError('');await signInWithPopup(auth,googleProvider)}catch(e){setLoginError(e.message)}}} error={loginError}/>

  const goHome=()=>{setScreen('home');setDraft(null);setPart('')}
  const saveRoutine=async(title,exercises)=>addDoc(collection(db,'users',user.uid,'routines'),{title,exercises,createdAt:serverTimestamp()})
  const saveWorkout=async(workout)=>{await addDoc(collection(db,'users',user.uid,'workouts'),{...workout,createdAt:serverTimestamp()});setScreen('history')}
  const addCustom=async name=>{const all=[...(DEFAULTS[part]||[]),...(custom[part]||[])];if(all.some(x=>x.toLowerCase()===name.toLowerCase()))return false;const next={...custom,[part]:[...(custom[part]||[]),name]};await setDoc(doc(db,'users',user.uid,'settings','customExercises'),{parts:next,updatedAt:serverTimestamp()},{merge:true});return true}

  let body
  if(screen==='start') body=<Start routines={routines} onBack={goHome} onRoutine={r=>{setDraft({title:r.title,names:r.exercises});setScreen('workout')}} onPart={p=>{setPart(p);setScreen('pick')}}/>
  else if(screen==='pick') body=<Picker part={part} names={[...(DEFAULTS[part]||[]),...(custom[part]||[])]} onBack={()=>setScreen('start')} onAdd={addCustom} onPick={name=>{setDraft({title:part,names:[name]});setScreen('workout')}}/>
  else if(screen==='workout') body=<Workout title={draft.title} names={draft.names} history={workouts} onBack={()=>setScreen('start')} onSave={saveWorkout}/>
  else if(screen==='routines') body=<Routines routines={routines} onBack={goHome} onSave={saveRoutine} onDelete={async id=>{if(confirm('削除しますか？'))await deleteDoc(doc(db,'users',user.uid,'routines',id))}}/>
  else if(screen==='history') body=<History workouts={workouts} onBack={goHome} onDelete={async id=>{if(confirm('この日の記録を削除しますか？'))await deleteDoc(doc(db,'users',user.uid,'workouts',id))}}/>
  else body=<Home onStart={()=>setScreen('start')} onHistory={()=>setScreen('history')} onRoutines={()=>setScreen('routines')}/>

  return <main className="shell"><header className="top"><button onClick={goHome}>BulkBro</button><div><span>{user.displayName}</span><button onClick={()=>signOut(auth)}>ログアウト</button></div></header>{body}</main>
}

function Login({onLogin,error}){return <div className="center"><section className="login"><p className="eyebrow">TRAINING LOG</p><h1>BulkBro</h1><p className="muted">GoogleログインでPC・スマホ同期。</p><button className="primary" onClick={onLogin}>Googleでログイン</button>{error&&<p className="error">{error}</p>}</section></div>}
function Home({onStart,onHistory,onRoutines}){return <section className="home"><div><p className="eyebrow">BUILD. LOG. REPEAT.</p><h1>BulkBro</h1><p className="muted">昨日の自分を超えるための筋トレ記録。</p></div><div className="stack"><button className="primary" onClick={onStart}>トレーニング開始</button><button onClick={onHistory}>履歴を見る</button><button onClick={onRoutines}>ルーティン管理</button></div></section>}
function Start({routines,onBack,onRoutine,onPart}){return <section><Back onClick={onBack}/><Head eyebrow="START WORKOUT" title="トレーニング開始"/>{routines.length>0&&<><h2>保存済みルーティン</h2><div className="stack">{routines.map(r=><button className="routine" key={r.id} onClick={()=>onRoutine(r)}><strong>{r.title}</strong><span>{r.exercises.length}種目</span></button>)}</div></>}<h2 className="space">部位から選ぶ</h2><div className="grid">{PARTS.map(p=><button className="part" key={p} onClick={()=>onPart(p)}>{p}</button>)}</div></section>}
function Picker({part,names,onBack,onAdd,onPick}){const [name,setName]=useState('');return <section><Back onClick={onBack}/><Head eyebrow="SELECT EXERCISE" title={part}/><div className="stack">{names.map(n=><button key={n} onClick={()=>onPick(n)}>{n}</button>)}</div><form className="card form" onSubmit={async e=>{e.preventDefault();const v=name.trim();if(!v)return;if(await onAdd(v))setName('')}}><h2>種目を自由追加</h2><input value={name} onChange={e=>setName(e.target.value)} placeholder="例：スミスマシンベンチ"/><button className="primary">＋ 追加</button></form></section>}
function Routines({routines,onBack,onSave,onDelete}){const [title,setTitle]=useState(''),[items,setItems]=useState('');return <section><Back onClick={onBack}/><Head eyebrow="MY ROUTINES" title="ルーティン管理"/><form className="card form" onSubmit={async e=>{e.preventDefault();const ex=items.split('\n').map(x=>x.trim()).filter(Boolean);if(!title.trim()||!ex.length)return alert('タイトルと種目を入力');await onSave(title.trim(),ex);setTitle('');setItems('')}}><label>自由タイトル<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="胸ルーティン"/></label><label>種目（1行に1種目）<textarea value={items} onChange={e=>setItems(e.target.value)} placeholder={'ベンチプレス\nサイドレイズ'}/></label><button className="primary">保存</button></form><div className="list">{routines.map(r=><article className="card" key={r.id}><div className="row"><div><h2>{r.title}</h2><small>{r.exercises.length}種目</small></div><button className="danger" onClick={()=>onDelete(r.id)}>×</button></div><ol>{r.exercises.map(x=><li key={x}>{x}</li>)}</ol></article>)}</div></section>}
function Workout({title,names,history,onBack,onSave}){const [startedAt]=useState(new Date()),[memo,setMemo]=useState(''),[exercises,setExercises]=useState(names.map(name=>({name,sets:[blankSet()]})));const volume=useMemo(()=>volumeOf(exercises),[exercises]);const previous=name=>{for(const w of history){const e=w.exercises?.find(x=>x.name===name);if(e)return e}return null};const best=name=>Math.max(0,...history.flatMap(w=>w.exercises?.filter(e=>e.name===name).flatMap(e=>e.sets.map(s=>Number(s.weight||0)))||[]));const update=(ei,si,k,v)=>setExercises(cur=>cur.map((e,i)=>i!==ei?e:{...e,sets:e.sets.map((s,j)=>j===si?{...s,[k]:v}:s)}));const addSet=ei=>setExercises(cur=>cur.map((e,i)=>i!==ei?e:{...e,sets:[...e.sets,{...(e.sets.at(-1)||blankSet())}]}));return <section><Back onClick={onBack}/><Head eyebrow="GYM MODE" title={title}/><div className="list">{exercises.map((e,ei)=>{const prev=previous(e.name), first=prev?.sets?.[0], suggestions=first?[['維持',first.weight,first.reps],['回数UP',first.weight,Number(first.reps)+1],['重量UP',Number(first.weight)+2.5,Math.max(1,Number(first.reps)-2)]]:[];return <article className="exercise" key={e.name}><div className="row"><h2>{e.name}</h2>{best(e.name)>0&&<span className="pr">PR {best(e.name)}kg</span>}</div>{prev&&<div className="previous"><small>前回</small><strong>{prev.sets.map(s=>`${s.weight}kg×${s.reps}`).join(' / ')}</strong></div>}{suggestions.length>0&&<div className="suggest">{suggestions.map(([l,w,r])=><button key={l} onClick={()=>{update(ei,0,'weight',String(w));update(ei,0,'reps',String(r))}}><small>{l}</small><strong>{w}kg×{r}</strong></button>)}</div>}<div className="sets">{e.sets.map((s,si)=><div className="set" key={si}><small>SET {si+1}</small><input type="number" step="0.5" value={s.weight} onChange={x=>update(ei,si,'weight',x.target.value)} placeholder="kg"/><input type="number" value={s.reps} onChange={x=>update(ei,si,'reps',x.target.value)} placeholder="回"/><select value={s.effort} onChange={x=>update(ei,si,'effort',x.target.value)}><option>余裕</option><option>普通</option><option>限界</option></select></div>)}</div><button className="small" onClick={()=>addSet(ei)}>＋ 前セットをコピー</button></article>})}</div><label className="memo">今日のメモ<textarea value={memo} onChange={e=>setMemo(e.target.value)}/></label><div className="summary"><span>総ボリューム</span><strong>{volume.toLocaleString()}kg</strong></div><button className="primary" onClick={async()=>{const cleaned=exercises.map(e=>({...e,sets:e.sets.filter(s=>s.weight!==''&&s.reps!=='').map(s=>({...s,weight:Number(s.weight),reps:Number(s.reps)}))})).filter(e=>e.sets.length);if(!cleaned.length)return alert('1種目以上入力');await onSave({title,startedAt:startedAt.toISOString(),endedAt:new Date().toISOString(),memo,volume:volumeOf(cleaned),exercises:cleaned})}}>今日のトレーニングを保存</button></section>}
function History({workouts,onBack,onDelete}){const fmt=v=>new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'long',day:'numeric',weekday:'short'}).format(new Date(v));return <section><Back onClick={onBack}/><Head eyebrow="WORKOUT HISTORY" title="履歴"/>{!workouts.length?<div className="empty">まだ記録がありません。</div>:<div className="list">{workouts.map(w=><article className="card" key={w.id}><div className="row"><div><time>{fmt(w.startedAt)}</time><h2>{w.title}</h2></div><button className="danger" onClick={()=>onDelete(w.id)}>×</button></div>{w.exercises.map(e=><section className="hist" key={e.name}><h3>{e.name}</h3>{e.sets.map((s,i)=><p key={i}>SET {i+1}　{s.weight}kg × {s.reps}回 <small>（{s.effort}）</small></p>)}</section>)}<strong className="total">総ボリューム {Number(w.volume||0).toLocaleString()}kg</strong></article>)}</div>}</section>}
function Back({onClick}){return <button className="back" onClick={onClick}>← 戻る</button>}
function Head({eyebrow,title}){return <header className="heading"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></header>}
