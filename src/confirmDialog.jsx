import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './confirm-dialog.css';

// An "Are you sure?" box drawn in the page. The browser's own confirm() is
// silently answered "No" in some embedded browsers (the Claude app's browser
// pane did exactly that, so Delete looked broken), so panels ask with this.
//
//   const [confirmBox, ask] = useConfirm();
//   if (!(await ask('Delete this?', { action: 'Delete', danger: true }))) return;
//   ... render {confirmBox} somewhere in the panel.
export function useConfirm() {
  const [request, setRequest] = useState(null);
  const resolver = useRef(null);

  const ask = useCallback((message, { action = 'OK', danger = false, detail = '' } = {}) => new Promise((resolve) => {
    resolver.current?.(false);
    resolver.current = resolve;
    setRequest({ message, action, danger, detail });
  }), []);

  const answer = useCallback((value) => {
    resolver.current?.(value);
    resolver.current = null;
    setRequest(null);
  }, []);

  useEffect(() => () => resolver.current?.(false), []);

  const box = request ? <ConfirmBox {...request} onAnswer={answer} /> : null;
  return [box, ask];
}

function ConfirmBox({ message, detail, action, danger, onAnswer }) {
  const yes = useRef(null); // the button that starts with the focus
  useEffect(() => {
    yes.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onAnswer(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onAnswer]);
  // Drawn at the top of the page, so no card around it can move or clip it.
  return createPortal(
    <div className="cd-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onAnswer(false); }}>
      <div className="cd-box" role="alertdialog" aria-modal="true" aria-labelledby="cd-message">
        <p id="cd-message" className="cd-message">{message}</p>
        {detail && <p className="cd-detail">{detail}</p>}
        <div className="cd-actions">
          {/* For a delete, Enter means Cancel: the safe answer has the focus. */}
          <button type="button" ref={danger ? yes : null} className="cd-btn" onClick={() => onAnswer(false)}>Cancel</button>
          <button type="button" ref={danger ? null : yes} className={`cd-btn ${danger ? 'danger' : 'primary'}`} onClick={() => onAnswer(true)}>{action}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
