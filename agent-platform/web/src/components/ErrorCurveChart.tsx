// 最简内联 SVG 条形图，不引入图表库。

interface Props {
  data: number[];
}

export function ErrorCurveChart({ data }: Props) {
  if (data.length === 0) {
    return <div className="empty-note">暂无硬验证记录（error_curve 为空）</div>;
  }

  const barW = 34;
  const gap = 14;
  const maxH = 150;
  const maxVal = Math.max(1, ...data);
  const width = data.length * (barW + gap) + gap;

  return (
    <div className="chart-wrap">
      <svg
        width={width}
        height={maxH + 44}
        role="img"
        aria-label="error_curve 条形图"
      >
        {data.map((v, i) => {
          const h = Math.max(4, (v / maxVal) * maxH);
          const x = gap + i * (barW + gap);
          const y = maxH - h + 20;
          const hot = v > 0;
          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={h}
                rx={3}
                className={hot ? 'bar-hot' : 'bar-cold'}
              />
              <text
                x={x + barW / 2}
                y={y - 6}
                textAnchor="middle"
                className="bar-value"
              >
                {v}
              </text>
              <text
                x={x + barW / 2}
                y={maxH + 40}
                textAnchor="middle"
                className="bar-label"
              >
                #{i + 1}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
