import { useRef, useLayoutEffect } from 'react'

// Expander — animates its children open/closed by tweening max-height.
//
// On mount it snaps to the current `open` state with no transition (so an
// initially-open panel doesn't animate in). After that, each `open` change
// animates: opening measures the inner content's scrollHeight (+16px breathing
// room) and sets that as max-height; closing pins the current height, forces a
// reflow, then drops to 0 so the CSS transition has two heights to tween between.
// A ResizeObserver keeps an open panel sized to its content if that content
// changes height while open. Pure presentational — no app state.
//
// Extracted from main.jsx in Stage C, Step 4a (verbatim; only the React-hook
// imports were added, since this is now its own module).
export default function Expander({open,children}){
  const outerRef=useRef(null);
  const innerRef=useRef(null);
  const prevOpenRef=useRef(open);
  const mountedRef=useRef(false);
  const resizeObsRef=useRef(null);
  useLayoutEffect(()=>{
    const el=outerRef.current;if(!el)return;
    const attachObs=()=>{
      if(typeof ResizeObserver==="undefined"||!innerRef.current||!outerRef.current)return;
      // Disconnect any prior observer before creating a new one. Currently the effect cleanup
      // handles disconnection between effect runs, so this guard only matters if a future change
      // calls attachObs twice within a single effect run (which would otherwise orphan the first).
      if(resizeObsRef.current){resizeObsRef.current.disconnect();resizeObsRef.current=null;}
      const obs=new ResizeObserver(()=>{
        if(!outerRef.current||!innerRef.current)return;
        outerRef.current.style.maxHeight=(innerRef.current.scrollHeight+16)+"px";
      });
      obs.observe(innerRef.current);
      resizeObsRef.current=obs;
    };
    if(!mountedRef.current){
      mountedRef.current=true;
      prevOpenRef.current=open;
      if(open){
        el.style.transition='none';
        el.style.maxHeight=(innerRef.current?.scrollHeight??0)+16+"px";
        el.getBoundingClientRect();
        el.style.transition='';
        attachObs();
      }else{
        el.style.maxHeight="0px";
      }
      return()=>{if(resizeObsRef.current){resizeObsRef.current.disconnect();resizeObsRef.current=null;}};
    }
    const wasOpen=prevOpenRef.current;prevOpenRef.current=open;
    if(open){
      el.style.maxHeight=(innerRef.current?.scrollHeight??0)+16+"px";
      attachObs();
    }else if(!wasOpen){
      el.style.maxHeight="0px";
    }else{
      el.style.maxHeight=el.scrollHeight+"px";
      el.getBoundingClientRect();
      el.style.maxHeight="0px";
    }
    return()=>{if(resizeObsRef.current){resizeObsRef.current.disconnect();resizeObsRef.current=null;}};
  },[open]);
  return(<div ref={outerRef} className="expander"><div ref={innerRef}>{children}</div></div>);
}
