// Only operational metadata. Never pass arbitrary errors, requests or provider payloads.
export function log(level,event,fields={}) {
  const record={level,event};
  for(const key of ['request_id','run_id','code','duration_ms','requested_count','returned_count']) {
    if(fields[key]!==undefined)record[key]=fields[key];
  }
  console[level==='error'?'error':'log'](JSON.stringify(record));
}
