// This boundary validates publication shape. Evidence quotes are checked against
// the model's longer input by the engine, not the deliberately short public excerpt.
export function validateShowcase(data) {
  const fail = code => { throw new Error(code); };
  const obj = (v,c) => { if (!v || typeof v !== 'object' || Array.isArray(v)) fail(c); return v; };
  const str = (v,c) => { if (typeof v !== 'string' || !v.trim()) fail(c); };
  const strings = (v,c) => { if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) fail(c); };
  const count = (v,c) => { if (!Number.isSafeInteger(v) || v < 0) fail(c); };
  const day = (v,c) => { if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) fail(c); const d=new Date(v+'T00:00:00Z'); if (!Number.isFinite(+d) || d.toISOString().slice(0,10)!==v) fail(c); };
  const time = (v,c) => { if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(v) || !Number.isFinite(Date.parse(v))) fail(c); day(v.slice(0,10),c); };
  const url = (v,c) => { str(v,c); let u; try { u=new URL(v); } catch { fail(c); } if (u.protocol!=='https:' || u.username || u.password) fail(c); return u; };
  const hash = (v,c) => { if (typeof v!=='string' || !/^[a-f\d]{64}$/i.test(v)) fail(c); };
  const scan = v => { if (typeof v==='string') { if (/(?:[A-Za-z]:[\\/](?:Users|Windows|ProgramData)[\\/]|Bearer\s+[\w.-]{16,}|sk-[\w-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(v)) fail('PRIVATE_VALUE'); return; } if (!v || typeof v!=='object') return; for (const [k,x] of Object.entries(v)) { if (/^(apiKey|api_key|authorization|accessToken|refreshToken|password|secret|privateKey|credentials|rawReference|collectionRunRef|fullText|contentText|observations|batches|tasks|installationId)$/i.test(k)) fail('PRIVATE_FIELD'); if (k==='synthetic' && x===true) fail('SYNTHETIC_DATA'); scan(x); } };
  scan(data); obj(data,'EXTERNAL_SCHEMA');
  if (data.schemaVersion!==1 || data.kind!=='agritwin-external-intelligence' || data.internal!==null || 'farm' in data || 'reports' in data || 'modelEvaluations' in data) fail('EXTERNAL_SCHEMA');
  const meta=obj(data.meta,'META'); if (meta.farmConnected!==false) fail('FARM_CONNECTED'); time(meta.generatedAt,'GENERATED_AT'); if(meta.dataAsOf!==null) time(meta.dataAsOf,'DATA_AS_OF');
  const modelStates=['not_run','succeeded','partial','failed']; if (!modelStates.includes(meta.modelExecution)) fail('MODEL_STATUS');
  const region=obj(data.region,'REGION'); str(region.name,'REGION_NAME'); str(region.context,'REGION_CONTEXT'); if (region.verified!==false || !Array.isArray(region.center) || region.center.length!==2 || !region.center.every(Number.isFinite) || Math.abs(region.center[0])>180 || Math.abs(region.center[1])>85) fail('REGION_CENTER');
  const categories=['policy','research','weather','guidance','tool']; const sourceStates=['success','partial','empty','blocked','failed'];
  if (!Array.isArray(data.sources) || data.sources.length>100 || !Array.isArray(data.articles) || data.articles.length>200) fail('COLLECTION_ARRAYS');
  if(meta.dataAsOf===null && data.articles.length) fail('MISSING_DATA_AS_OF');
  const sources=new Map(), articleIds=new Set();
  for (const s of data.sources) { obj(s,'SOURCE'); str(s.id,'SOURCE_ID'); if (sources.has(s.id)) fail('DUPLICATE_SOURCE'); str(s.name,'SOURCE_NAME'); url(s.url,'SOURCE_URL'); if (!categories.includes(s.category) || !sourceStates.includes(s.status)) fail('SOURCE_STATUS'); if (typeof s.credentialRequired!=='boolean') fail('CREDENTIAL_FLAG'); str(s.priority,'SOURCE_PRIORITY'); str(s.accessMethod,'SOURCE_ACCESS'); if (typeof s.reason!=='string') fail('SOURCE_REASON'); count(s.articleCount,'SOURCE_COUNT'); if (s.fetchedAt!==null) time(s.fetchedAt,'SOURCE_TIME'); sources.set(s.id,s); }
  let succeeded=0;
  for (const a of data.articles) {
    obj(a,'ARTICLE'); str(a.id,'ARTICLE_ID'); if (articleIds.has(a.id)) fail('DUPLICATE_ARTICLE'); articleIds.add(a.id); if (!sources.has(a.sourceId)) fail('SOURCE_REFERENCE'); if (a.synthetic!==false) fail('SYNTHETIC_DATA'); if (!categories.includes(a.category) || a.extractionStatus!=='collected') fail('ARTICLE_STATUS'); str(a.title,'ARTICLE_TITLE'); str(a.publisher,'ARTICLE_PUBLISHER'); str(a.excerpt,'ARTICLE_EXCERPT'); if([...a.excerpt].length>180) fail('EXCERPT_LENGTH'); const articleURL=url(a.url,'ARTICLE_URL').href;
    if (!['datetime','date','unknown'].includes(a.datePrecision)) fail('DATE_PRECISION'); if (a.publishedAt!==null) time(a.publishedAt,'PUBLISHED_AT'); if (a.publishedDate!==null) day(a.publishedDate,'PUBLISHED_DATE');
    if ((a.datePrecision==='datetime' && (a.publishedAt===null || a.publishedDate!==a.publishedAt.slice(0,10))) || (a.datePrecision==='date' && (a.publishedAt!==null || a.publishedDate===null)) || (a.datePrecision==='unknown' && (a.publishedAt!==null || a.publishedDate!==null))) fail('DATE_PRECISION_BINDING');
    time(a.fetchedAt,'FETCHED_AT'); hash(a.contentHash,'CONTENT_HASH'); hash(a.responseHash,'RESPONSE_HASH'); strings(a.tags,'TAGS'); strings(a.limitations,'LIMITATIONS');
    const m=obj(a.modelSummary,'MODEL_SUMMARY'); if (!['succeeded','failed','not_run','budget_deferred'].includes(m.status)) fail('SUMMARY_STATUS'); strings(m.citations,'CITATIONS'); strings(m.limitations,'SUMMARY_LIMITATIONS'); if (m.citations.some(u=>url(u,'CITATION_URL').href!==articleURL)) fail('CITATION_BINDING');
    if (m.status==='succeeded') { succeeded++; str(m.summary,'SUMMARY_TEXT'); str(m.evidenceQuote,'EVIDENCE_QUOTE'); if([...m.summary].length>160) fail('SUMMARY_LENGTH'); if([...m.evidenceQuote].length<8 || [...m.evidenceQuote].length>100) fail('QUOTE_LENGTH'); if (m.citations.length!==1) fail('CITATION_COUNT'); }
    else if (m.summary!==null || m.evidenceQuote!==null || m.citations.length!==0) fail('NEGATIVE_SUMMARY');
  }
  for (const s of sources.values()) { const actual=data.articles.filter(a=>a.sourceId===s.id).length; if (s.articleCount!==actual) fail('SOURCE_COUNT_MISMATCH'); if (['empty','blocked','failed'].includes(s.status) && actual!==0) fail('SOURCE_STATUS_MISMATCH'); }
  const collection=obj(data.collection,'COLLECTION'); if (!['success','partial','failed'].includes(collection.status) || collection.articleCount!==data.articles.length || !Array.isArray(collection.sourceStatuses)) fail('COLLECTION_COUNTS'); if (collection.status==='failed' && data.articles.length) fail('FAILED_COLLECTION_ARTICLES');
  const statusIds=new Set(); for(const s of collection.sourceStatuses){if(statusIds.has(s.sourceId) || !sources.has(s.sourceId) || sources.get(s.sourceId).status!==s.status) fail('SOURCE_STATUS_BINDING'); statusIds.add(s.sourceId);} if(statusIds.size!==sources.size) fail('SOURCE_STATUS_BINDING');
  const run=obj(data.modelRun,'MODEL_RUN'); if (run.status!==meta.modelExecution) fail('MODEL_STATUS_MISMATCH'); if(run.model!=='kimi-k2.6') fail('MODEL_NAME'); str(run.summary,'MODEL_DESCRIPTION'); count(run.calls,'MODEL_CALLS'); if(run.calls>3) fail('MODEL_CALL_BUDGET');
  for (const field of ['ranAt','finishedAt']) if (run[field]!==null) time(run[field],'MODEL_TIME');
  const workflow=url(run.workflowUrl,'WORKFLOW_URL'); if (workflow.hostname!=='github.com' || workflow.port || !/^\/No1dry\/AgriTwin-Intelligence\/actions\/(?:workflows\/external-live\.yml|runs\/[1-9]\d*)\/?$/.test(workflow.pathname)) fail('WORKFLOW_TARGET');
  if (run.usage!==null) { obj(run.usage,'USAGE'); for (const field of ['promptTokens','completionTokens','totalTokens']) count(run.usage[field],'USAGE_VALUE'); if (run.usage.totalTokens!==run.usage.promptTokens+run.usage.completionTokens) fail('USAGE_TOTAL'); }
  if (run.status==='not_run' && (run.calls!==0 || succeeded || (run.usage && run.usage.totalTokens!==0))) fail('UNRUN_MODEL'); if (run.status==='failed' && succeeded) fail('FAILED_MODEL_RESULTS'); if (succeeded && run.calls===0) fail('RESULT_WITHOUT_CALL'); if (['succeeded','partial'].includes(run.status) && !succeeded) fail('SUCCESS_WITHOUT_RESULT'); if (run.calls===0 && run.usage && run.usage.totalTokens>0) fail('USAGE_WITHOUT_CALL');
  if (data.weather!==null) { const w=obj(data.weather,'WEATHER'); if (w.kind!=='model_forecast' || !Number.isFinite(w.latitude) || !Number.isFinite(w.longitude) || Math.abs(w.latitude)>90 || Math.abs(w.longitude)>180) fail('WEATHER_KIND'); for (const k of ['temperatureC','humidityPercent','windKph','precipitationMm']) if (w[k]!==null && !Number.isFinite(w[k])) fail('WEATHER_VALUE'); time(w.time,'WEATHER_TIME'); str(w.provider,'WEATHER_PROVIDER'); }
  return data;
}
