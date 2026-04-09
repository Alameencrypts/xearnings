
var fmt = function(n){ return n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); };
var fmtM = function(n){ return n>=1000000?(n/1000000).toFixed(1)+'M':n>=1000?(n/1000).toFixed(1)+'K':String(Math.round(n)); };
var currentData = null;

document.getElementById('nav-date').textContent = new Date().toLocaleString('en-US',{month:'long',year:'numeric'});

document.getElementById('search-btn').addEventListener('click', doCalculate);
document.getElementById('handle-input').addEventListener('keydown', function(e){ if(e.key==='Enter') doCalculate(); });
document.getElementById('s-reg').addEventListener('change', recalc);
document.getElementById('s-niche').addEventListener('change', recalc);
document.getElementById('s-ctype').addEventListener('change', recalc);
document.getElementById('s-prem').addEventListener('input', function(){ document.getElementById('lprem').textContent=this.value+'%'; recalc(); });

function doCalculate() {
  var raw = document.getElementById('handle-input').value.trim().replace('@','');
  if (!raw) return;
  var btn = document.getElementById('search-btn');
  var err = document.getElementById('err-box');
  btn.disabled = true;
  btn.textContent = 'Loading...';
  err.style.display = 'none';
  document.getElementById('profile-card').style.display = 'none';
  document.getElementById('payout-card').style.display = 'none';
  document.getElementById('manual-section').style.display = 'none';
  fetch('/api/user/' + encodeURIComponent(raw))
    .then(function(r){ return r.json(); })
    .then(function(data){
      if (data.error){ err.textContent=data.error; err.style.display='block'; }
      else { currentData=data; renderProfile(data); }
    })
    .catch(function(){ err.textContent='Network error. Please try again.'; err.style.display='block'; })
    .finally(function(){ btn.disabled=false; btn.textContent='Calculate'; });
}

function renderProfile(d) {
  var av = document.getElementById('p-av');
  var imgUrl = d.profile_image && typeof d.profile_image === 'object' ? d.profile_image.image_url : d.profile_image;
  if (imgUrl) {
    var img = new Image();
    img.onload = function(){ av.innerHTML=''; av.appendChild(img); };
    img.onerror = function(){ av.textContent=(d.name||'?')[0]; };
    img.src = imgUrl;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
  } else { av.textContent=(d.name||'?')[0]; }

  document.getElementById('p-name').textContent = d.name||'—';
  document.getElementById('p-handle').textContent = d.handle||'—';
  document.getElementById('p-verified').style.display = d.is_verified ? 'inline-flex' : 'none';
  document.getElementById('s-fol').textContent = fmtM(d.followers||0);
  document.getElementById('s-fing').textContent = fmtM(d.following||0);
  document.getElementById('s-14d').textContent = d.posts_14d||0;
  document.getElementById('s-ppw').textContent = d.posts_per_week||0;
  document.getElementById('sc-algo').textContent = Math.round(d.algo_score||0).toLocaleString();
  document.getElementById('algo-bar').style.width = Math.min((d.algo_score||0)/20000*100,100)+'%';
  document.getElementById('sc-infl').textContent = (d.influence_score||0).toLocaleString();
  document.getElementById('infl-bar').style.width = ((d.influence_score||0)/10)+'%';
  var lblEl = document.getElementById('infl-label');
  lblEl.textContent = d.influence_label||'—';
  var lblColors = {Elite:'#f59e0b',Established:'#a78bfa',Growing:'#4ade80',Rising:'#60a5fa',New:'#888'};
  lblEl.style.color = lblColors[d.influence_label]||'#888';

  var box = document.getElementById('elig-box');
  var ic = document.getElementById('elig-ic');
  var lbl = document.getElementById('elig-lbl');
  var note = document.getElementById('elig-note');
  var reasons = document.getElementById('elig-reasons');
  box.style.display = 'block';
  if (d.is_eligible) {
    box.className='elig-box ok'; ic.className='elig-ic ok'; ic.textContent='✓';
    lbl.className='elig-lbl ok'; lbl.textContent='Eligible for Creator Revenue Sharing';
    note.style.display='block'; note.textContent='X may pause monetization for policy violations, account review, or other reasons not visible via API.';
    reasons.innerHTML='';
  } else {
    box.className='elig-box fail'; ic.className='elig-ic fail'; ic.textContent='x';
    lbl.className='elig-lbl fail'; lbl.textContent='Not eligible for Creator Revenue Sharing';
    note.style.display='none';
    reasons.innerHTML=(d.eligibility_reasons||[]).map(function(r){return '<li>'+r+'</li>';}).join('');
  }

  document.getElementById('payout-amount').textContent='$'+fmt(d.biweekly_earnings||0);
  document.getElementById('payout-date').textContent='Next payout: '+(d.next_payout_date||'—');
  document.getElementById('profile-card').style.display='block';
  document.getElementById('payout-card').style.display='block';
  document.getElementById('manual-section').style.display='block';
  renderShareCard(d);
}

function renderShareCard(d) {
  var imgUrl = d.profile_image && typeof d.profile_image === 'object' ? d.profile_image.image_url : d.profile_image;
  var scAv = document.getElementById('sc-av');
  if (imgUrl) {
    var img = new Image();
    img.onload = function(){ scAv.innerHTML=''; scAv.appendChild(img); };
    img.onerror = function(){ scAv.textContent=(d.name||'?')[0]; };
    img.src = imgUrl;
    img.style.cssText='width:100%;height:100%;object-fit:cover;';
  } else { scAv.textContent=(d.name||'?')[0]; }
  document.getElementById('sc-amt').textContent='$'+fmt(d.biweekly_earnings||0);
  document.getElementById('sc-date').textContent='Next: '+(d.next_payout_date||'—');
  document.getElementById('sc-fol').textContent=fmtM(d.followers||0);
  document.getElementById('sc-ppw').textContent=d.posts_per_week||'—';
  document.getElementById('sc-infl2').textContent=(d.influence_score||0).toLocaleString();
  document.getElementById('sc-handle').textContent=d.handle||'—';
  document.getElementById('share-section').style.display='block';
}

document.getElementById('dl-btn').addEventListener('click', function() {
  var btn = document.getElementById('dl-btn');
  btn.disabled=true; btn.textContent='Generating...';
  var card = document.getElementById('share-card');
  html2canvas(card,{scale:2,backgroundColor:'#050a05',useCORS:true,allowTaint:true,logging:false})
    .then(function(canvas){
      var link=document.createElement('a');
      var handle=(document.getElementById('sc-handle').textContent||'card').replace('@','');
      link.download='xearnings-'+handle+'.png';
      link.href=canvas.toDataURL('image/png');
      link.click();
    })
    .catch(function(){ alert('Download failed. Please try again.'); })
    .finally(function(){ btn.disabled=false; btn.innerHTML='<svg viewBox="0 0 24 24" width="16" height="16" fill="#000"><path d="M12 16l-4-4h2.5V4h3v8H16l-4 4zm-6 4v-2h12v2H6z"/></svg> Download and Share on X'; });
});

function recalc() {
  if (!currentData) return;
  var cpm=+(document.getElementById('s-reg').value)||5;
  var niche=+(document.getElementById('s-niche').value)||1;
  var prem=+(document.getElementById('s-prem').value)/100||0.1;
  var ctype=+(document.getElementById('s-ctype').value)||1;
  var fol=currentData.followers||1000;
  var score=currentData.algo_score||0;
  var posts=currentData.posts_per_week||1;
  var reach=fol*(0.04+(score/10000)*0.06)*ctype;
  var biweekly=(reach*prem/1000)*cpm*niche*0.525*posts*2;
  document.getElementById('payout-amount').textContent='$'+fmt(biweekly);
}
