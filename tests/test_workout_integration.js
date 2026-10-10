const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const web=path.join(__dirname,'..','web');
async function main(){
 const dom=new JSDOM(fs.readFileSync(path.join(web,'index.html'),'utf8'),{url:'http://localhost/',runScripts:'outside-only'});
 const w=dom.window,context=dom.getInternalVMContext(),requests=[];
 const fixture={ok:true,today:'2026-10-10',goals:{calories:2000,protein:140,carbs:250,fat:70,monthBudget:100,studyMinutes:120,currency:'toman'},nutrition:{today:{calories:0,protein:0,carbs:0,fat:0},recent:[],week:{}},foods:[],expenses:{todayTotal:0,monthTotal:0,monthBudget:100,byCategory:{},recent:[]},workouts:{today:[],recent:[],muscleStatus:{},effort:{},todayBurned:0},study:{todayMinutes:0,recent:[],week:{}},tasks:[],classes:[],changes:[]};
 w.lucide={createIcons(){}};w.Chart=class{destroy(){}};
 w.fetch=async(url,opts)=>{const req=JSON.parse(opts.body);requests.push(req);let data;
 if(req.action==='state')data=fixture;
 else if(req.action==='parse.workout')data={ok:true,kind:'workout',matched:true,muscles:['chest','triceps'],durationMin:30};
 else if(req.action==='parse.workout.image')data={ok:true,recognised:true,muscles:['quads'],effort:[{muscle:'quads',level:1}]};
 else throw new Error('Unexpected request '+req.action);
 return {ok:true,json:async()=>data};};
 try{
  for(const file of ['bodymap.js',...(fs.existsSync(path.join(web,'sync.js'))?['sync.js']:[]),'app.js'])vm.runInContext(fs.readFileSync(path.join(web,file),'utf8'),context);
  const run=code=>vm.runInContext(code,context),get=id=>w.document.getElementById(id);
  await new Promise(resolve=>w.setTimeout(resolve,0));
  requests.length=0;
  get('wk-input').value='bench press 4x10';
  await run('estimateWorkoutMuscles()');
  assert.equal(requests.length,1);assert.equal(requests[0].action,'parse.workout');assert.equal(get('wk-ai-status').dataset.state,'ready');
  assert.equal(run('S.muscles.has("chest")'),true);assert.equal(run('globalThis.TPSync ? TPSync.pending() : 0'),0);
  console.log('✓ text-only estimate uses the workout parser with the offline module loaded');
  requests.length=0;await run('S.workoutPhoto="data:image/jpeg;base64,YWJj";estimateWorkoutMuscles()');
  assert.equal(requests.length,1);assert.equal(requests[0].action,'parse.workout.image');assert.equal(run('S.muscles.has("quads")'),true);assert.equal(run('globalThis.TPSync ? TPSync.pending() : 0'),0);
  console.log('✓ photo estimate stays a network read and updates selected muscles');
  requests.length=0;get('wk-input').value='';await run('S.workoutPhoto=null;estimateWorkoutMuscles()');
  assert.equal(requests.length,0);assert.equal(get('wk-ai-status').dataset.state,'empty');assert.match(get('wk-ai-status').textContent,/Enter a workout/);
  console.log('✓ empty estimate gives instructions without sending a request');
  if(w.TPSync){
  Object.defineProperty(w.navigator,'onLine',{configurable:true,value:false});
  requests.length=0;await run('api("log.study",{subject:"Offline test",minutes:10})');
  assert.equal(requests.length,0);assert.equal(run('globalThis.TPSync ? TPSync.pending() : 0'),1);assert.equal(run('S.data.study.todayMinutes'),10);
  console.log('✓ offline logging remains local and queued after estimation');
  run('TPSync.clear()');
  }
 }finally{w.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
