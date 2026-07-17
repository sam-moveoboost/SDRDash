import React, { useEffect, useState } from 'react';

export default function ProgressBar({ loading }) {
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (loading) {
      setVisible(true);
      setWidth(0);
      const t1 = setTimeout(() => setWidth(30), 50);
      const t2 = setTimeout(() => setWidth(60), 400);
      const t3 = setTimeout(() => setWidth(80), 1200);
      const t4 = setTimeout(() => setWidth(92), 2500);
      return () => [t1, t2, t3, t4].forEach(clearTimeout);
    } else {
      setWidth(100);
      const t = setTimeout(() => setVisible(false), 400);
      return () => clearTimeout(t);
    }
  }, [loading]);

  if (!visible) return null;

  return (
    <div className="fixed top-[60px] left-0 right-0 z-50 h-[3px] bg-transparent">
      <div
        className="h-full bg-mint rounded-r-full transition-all ease-out"
        style={{
          width: `${width}%`,
          transitionDuration: width === 100 ? '200ms' : width === 0 ? '0ms' : '800ms',
        }}
      />
    </div>
  );
}
