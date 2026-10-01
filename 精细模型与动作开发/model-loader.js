(()=>{
  const script=document.createElement('script');
  script.src=location.protocol==='file:'?'demo.offline.js?v=25':'demo.bundle.js?v=25';
  script.onerror=()=>{document.getElementById('loading').textContent='模型资源加载失败，请刷新后重试；文字说明仍可查看。';};
  document.body.append(script);
})();
