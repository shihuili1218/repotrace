import { useLayoutEffect, useRef, type SVGProps } from 'react';

// The plots use different viewBoxes and column widths. Keep labels at the
// activity chart's 12px text size instead of scaling them with the plot.
export function ChartSvg(props: SVGProps<SVGSVGElement>) {
  const ref = useRef<SVGSVGElement>(null);

  useLayoutEffect(() => {
    const svg = ref.current!;
    const resizeLabels = () => {
      const matrix = svg.getScreenCTM();
      if (!matrix) return;
      const scale = Math.hypot(matrix.a, matrix.b);
      if (scale > 0 && Number.isFinite(scale))
        svg.style.setProperty('--chart-axis-size', `${12 / scale}px`);
    };
    resizeLabels();
    const observer = new ResizeObserver(resizeLabels);
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  return <svg {...props} ref={ref} />;
}
