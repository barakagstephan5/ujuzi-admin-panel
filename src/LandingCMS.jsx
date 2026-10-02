import { useCallback, useEffect, useState } from 'react';
import { FileText, Plus, Save, Upload, ArrowUp, ArrowDown, Trash2, RefreshCw } from 'lucide-react';
import { adminCall } from './adminApi';
import './landing-cms.css';

const clone = value => structuredClone(value);
const label = key => ({items:'Entries',iconIndex:'Icon style (existing icon number)',enabled:'Show this section',appUrl:'Learning app link',logoUrl:'Logo image URL',pageTitle:'SEO page title',pageDescription:'SEO description',includesBusiness:'Include Business courses',price:'Displayed price (TZS)',is_published:'Published / publicly downloadable'}[key] || key.replace(/([A-Z])/g,' $1').replace(/_/g,' ').replace(/^./,value=>value.toUpperCase()));
const blank = template => typeof template === 'string' ? '' : Array.isArray(template) ? [] : template && typeof template === 'object' ? Object.fromEntries(Object.entries(template).map(([key,value])=>[key,key==='iconIndex' ? value : blank(value)])) : template;

async function upload(file,kind,title='',description='') {
  const form = new FormData();
  form.set('file',file); form.set('kind',kind); form.set('title',title); form.set('description',description);
  return adminCall('admin-landing',form);
}

function Editor({value,template,onChange,name='',disabled,onImage}) {
  if (Array.isArray(value)) return <fieldset className="cms-list"><legend>{label(name)}</legend>
    {value.map((item,index)=><div className="cms-entry" key={index}>
      <div className="cms-entry-head"><strong>{index+1}. {item?.title || item?.name || item?.label || item?.q || label(name)}</strong><div className="cms-actions">
        <button type="button" disabled={disabled || index===0} aria-label="Move up" onClick={()=>{const next=[...value];[next[index-1],next[index]]=[next[index],next[index-1]];onChange(next);}}><ArrowUp/></button>
        <button type="button" disabled={disabled || index===value.length-1} aria-label="Move down" onClick={()=>{const next=[...value];[next[index+1],next[index]]=[next[index],next[index+1]];onChange(next);}}><ArrowDown/></button>
        <button type="button" disabled={disabled} aria-label="Remove entry" onClick={()=>onChange(value.filter((_,i)=>i!==index))}><Trash2/></button>
      </div></div>
      <Editor value={item} template={template?.[0]} name={typeof item==='string' ? 'Text' : ''} disabled={disabled} onImage={onImage} onChange={entry=>onChange(value.map((old,i)=>i===index ? entry : old))}/>
    </div>)}
    <button className="secondary" type="button" disabled={disabled || value.length>=100} onClick={()=>onChange([...value,blank(template[0])])}><Plus/>Add entry</button>
  </fieldset>;
  if(value && typeof value==='object')return <div className="cms-fields">{Object.entries(value).map(([key,entry])=><Editor key={key} name={key} value={entry} template={template?.[key]} disabled={disabled} onImage={onImage} onChange={next=>onChange({...value,[key]:next})}/>)}</div>;
  if(typeof value==='boolean')return <label className="cms-check"><input type="checkbox" disabled={disabled} checked={value} onChange={e=>onChange(e.target.checked)}/>{label(name)}</label>;
  const image=/ImageUrl$|logoUrl$/.test(name);
  return <div className="cms-field"><label>{label(name)}
    {typeof value==='number' ? <input type="number" disabled={disabled} min="0" max="1000000" value={value} onChange={e=>onChange(Number(e.target.value))}/> :
      /desc|story|quote|subtitle|Text|^a$|Note|Message/i.test(name) ? <textarea rows="3" maxLength="10000" disabled={disabled} value={value} onChange={e=>onChange(e.target.value)}/> : <input maxLength="10000" disabled={disabled} value={value} onChange={e=>onChange(e.target.value)}/>}
  </label>
    {image && <><label className="cms-upload">Upload image (PNG / JPEG / WebP, 5 MB max)<input disabled={disabled} type="file" accept="image/png,image/jpeg,image/webp" onChange={async e=>{const file=e.target.files?.[0];if(file)await onImage(file,onChange);e.target.value='';}}/></label>{value && <img className="cms-preview" src={value} alt="Selected image"/>}</>}
  </div>;
}

export default function LandingCMS() {
  const [record,setRecord]=useState(null),[content,setContent]=useState(null),[template,setTemplate]=useState(null);
  const [materials,setMaterials]=useState([]),[section,setSection]=useState('site'),[tab,setTab]=useState('content');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[dirty,setDirty]=useState(false);
  const [edit,setEdit]=useState(null),[file,setFile]=useState(null),[archived,setArchived]=useState(false);
  const load=useCallback(async()=>{
    setBusy(true);setError('');
    try{const result=await adminCall('admin-landing',{action:'get'});setRecord(result.content);setContent(clone(result.content.draft_content));setTemplate(result.template);setMaterials(result.materials);setDirty(false);}
    catch(e){setError(e.message);}finally{setBusy(false);}
  },[]);
  useEffect(()=>{load();},[load]);
  useEffect(()=>{
    const warn=e=>{if(dirty){e.preventDefault();e.returnValue='';}};
    window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
  },[dirty]);
  const run=async fn=>{setBusy(true);setError('');setMessage('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}};
  const save=publish=>run(async()=>{
    if(publish && !confirm('Publish all current homepage content? Visitors will see these changes.'))return;
    const result=await adminCall('admin-landing',{action:'save',content,revision:record.revision,publish});
    setRecord(result.content);setContent(clone(result.content.draft_content));setDirty(false);setMessage(publish ? 'Published. Refresh the landing page to see changes.' : 'Draft saved. Visitors still see the published version.');
  });
  const imageUpload=(image,done)=>run(async()=>{if(image.size>5242880)throw new Error('Image must be at most 5 MB.');const result=await upload(image,'image');done(result.url);setMessage('Image uploaded. Save or publish the content to use it.');});
  const updateMaterial=material=>setMaterials(old=>[...old.filter(item=>item.id!==material.id),material].sort((a,b)=>a.sort_order-b.sort_order || a.created_at.localeCompare(b.created_at)));
  const shareLink = id => { const url=new URL('/materials/',record.published_content.site.websiteUrl); if(id)url.searchParams.set('material',id);return url.toString(); };
  const copyLink = id => run(async()=>{const link=shareLink(id);try{await navigator.clipboard.writeText(link);setMessage('Share link copied: '+link);}catch{setMessage('Copy this share link: '+link);}});
  const saveMaterial=()=>run(async()=>{
    if(!edit.title.trim())throw new Error('Enter a material title.');
    if(edit.id){
      const result=await adminCall('admin-landing',{action:'save_material',id:edit.id,updated_at:edit.updated_at,item:{title:edit.title,description:edit.description,sort_order:Number(edit.sort_order),is_published:edit.is_published}});
      updateMaterial(result.material);
    }else{
      if(!file || file.size>20971520 || !file.name.toLowerCase().endsWith('.pdf'))throw new Error('Choose a PDF up to 20 MB.');
      const result=await upload(file,'pdf',edit.title,edit.description);updateMaterial(result.material);
    }
    setEdit(null);setFile(null);setMessage('Material saved. New uploads are drafts; publish when ready.');
  });
  const changeStatus=(material,action)=>run(async()=>{
    if(action==='archive_material' && !confirm('Remove this material from the website? The PDF is retained and can be restored from Archived.'))return;
    const result=await adminCall('admin-landing',{action,id:material.id});updateMaterial(result.material);setMessage(action==='archive_material'?'Material archived; public downloads disabled.':'Restored as a draft.');
  });
  const toggleMaterial=material=>run(async()=>{
    const result=await adminCall('admin-landing',{action:'save_material',id:material.id,updated_at:material.updated_at,item:{title:material.title,description:material.description,sort_order:material.sort_order,is_published:!material.is_published}});
    updateMaterial(result.material);setMessage(result.material.is_published?'PDF is now publicly downloadable.':'PDF unpublished.');
  });
  return <section className="card cms"><div className="card-head"><h2>Landing page CMS</h2><p>Marketing content and free downloads only. This does not change app checkout prices, paid materials, or Flutter.</p></div>
    {error && <div className="alert error" role="alert">{error}</div>}{message && <div className="alert success" role="status">{message}</div>}
    <div className="subnav"><button className={tab==='content'?'active':''} onClick={()=>setTab('content')}>Homepage content</button><button className={tab==='materials'?'active':''} onClick={()=>setTab('materials')}>PDF materials</button><button disabled={busy} onClick={()=>{if(!dirty || confirm('Discard unsaved edits and reload?'))load();}}><RefreshCw/>Reload</button></div>
    {!content ? <p>{busy?'Loading CMS…':'CMS could not load. Click Reload to retry.'}</p> : tab==='content' ? <>
      <div className="cms-toolbar"><span>Revision {record.revision}{dirty?' · unsaved edits':''}<br/>Last published: {new Date(record.published_at).toLocaleString()}</span>
        <div className="cms-actions"><button className="secondary" disabled={busy} onClick={()=>save(false)}><Save/>Save draft</button><button className="primary" disabled={busy} onClick={()=>save(true)}><Upload/>{busy?'Working…':'Publish homepage'}</button></div>
      </div>
      <div className="cms-layout"><aside aria-label="Homepage sections">{Object.keys(content).map(key=><button key={key} className={section===key?'active':''} disabled={busy} onClick={()=>setSection(key)}>{label(key)}</button>)}</aside>
        <div className="cms-editor"><h3>{label(section)}</h3>{section==='pricing' && <p className="hint">These are landing-page display prices only. Real checkout pricing remains controlled by the payment backend.</p>}
          <Editor value={content[section]} template={template[section]} disabled={busy} onImage={imageUpload} onChange={next=>{setContent(old=>({...old,[section]:next}));setDirty(true);}}/>
        </div></div>
      <button className="secondary" disabled={busy} onClick={()=>{if(confirm('Replace this draft with the last published content?')){setContent(clone(record.published_content));setDirty(true);}}}>Restore published content into draft</button>
    </> : <>
      <div className="cms-toolbar"><button className="secondary" disabled={busy} onClick={()=>copyLink()}>Copy materials page link</button><a href={shareLink()} target="_blank" rel="noopener noreferrer">Open public materials page</a><a href={import.meta.env.VITE_LANDING_PREVIEW_URL || 'http://127.0.0.1:3000/materials/'} target="_blank" rel="noopener noreferrer">Local preview</a></div>
      <p className="hint">Upload PDFs up to 20 MB. Drafts and archived files cannot be downloaded publicly. Changes here take effect immediately when you publish a material. Public page links work after the updated landing website is deployed.</p>
      {edit ? <div className="cms-fields"><label>Title<input maxLength="160" disabled={busy} value={edit.title} onChange={e=>setEdit({...edit,title:e.target.value})}/></label>
        <label>Description<textarea maxLength="3000" rows="3" disabled={busy} value={edit.description} onChange={e=>setEdit({...edit,description:e.target.value})}/></label>
        {!edit.id ? <label>PDF<input disabled={busy} type="file" accept="application/pdf,.pdf" onChange={e=>setFile(e.target.files?.[0] || null)}/></label> : <><p>{edit.filename} · {(edit.size_bytes/1048576).toFixed(1)} MB</p><label>Order<input type="number" disabled={busy} value={edit.sort_order} onChange={e=>setEdit({...edit,sort_order:Number(e.target.value)})}/></label><label className="cms-check"><input type="checkbox" disabled={busy} checked={edit.is_published} onChange={e=>setEdit({...edit,is_published:e.target.checked})}/>Published / publicly downloadable</label></>}
        <div className="cms-actions"><button className="primary" disabled={busy} onClick={saveMaterial}><Save/>{busy?'Saving…':'Save material'}</button><button className="secondary" disabled={busy} onClick={()=>{setEdit(null);setFile(null);}}>Cancel</button></div>
      </div> : <>
        <div className="cms-toolbar"><button className="primary" disabled={busy} onClick={()=>{setEdit({title:'',description:'',sort_order:0,is_published:false});setFile(null);}}><Plus/>Upload PDF</button><label className="cms-check"><input type="checkbox" checked={archived} onChange={e=>setArchived(e.target.checked)}/>Show archived</label></div>
        {!materials.some(item=>Boolean(item.deleted_at)===archived) && <div className="empty">No {archived?'archived':'uploaded'} materials.</div>}
        {materials.filter(item=>Boolean(item.deleted_at)===archived).map(item=><div key={item.id} className="cms-material"><FileText/><div><strong>{item.title}</strong><small>{item.deleted_at?'Archived':item.is_published?'Published':'Draft'} · {item.filename} · {(item.size_bytes/1048576).toFixed(1)} MB · order {item.sort_order}</small></div><div className="cms-actions">
          {item.deleted_at ? <button className="secondary" disabled={busy} onClick={()=>changeStatus(item,'restore_material')}>Restore draft</button> : <><button className="secondary" disabled={busy || !item.is_published} onClick={()=>copyLink(item.id)}>Copy PDF page link</button><button className="secondary" disabled={busy} onClick={()=>toggleMaterial(item)}>{item.is_published?'Unpublish':'Publish'}</button><button className="secondary" disabled={busy} onClick={()=>setEdit({...item})}>Edit</button><button className="secondary" disabled={busy} onClick={()=>changeStatus(item,'archive_material')}>Archive</button></>}
        </div></div>)}
      </>}
    </>}
  </section>;
}
