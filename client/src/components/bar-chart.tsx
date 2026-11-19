import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useI18n } from '@/i18n';
import { formatMoney } from '@shared/money';
import { Button } from './ui/button';

export interface BarDatum {
  label: string;
  /** Paisa. */
  value: number;
}

/** "Rs 12K" style ticks: whole numbers under 10,000, compact above. */
function compactMoney(paisa: number): string {
  const rs = paisa / 100;
  if (Math.abs(rs) >= 1_000_000) return `${Math.round(rs / 100_000) / 10}M`;
  if (Math.abs(rs) >= 10_000) return `${Math.round(rs / 1000)}K`;
  return Math.round(rs).toLocaleString('en-US');
}

/**
 * Single-series column chart of money (one hue → no legend; the card title names the series).
 * Hover tooltip on every bar, the latest bar labelled directly, and a table view for exact values.
 */
export function MoneyBarChart({ data, height = 260, valueName }: { data: BarDatum[]; height?: number; valueName: string }) {
  const { t } = useI18n();
  const [asTable, setAsTable] = useState(false);
  const last = data.length - 1;

  return (
    <div>
      <div className="mb-1 flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => setAsTable((v) => !v)}>
          {asTable ? t('dash.showChart') : t('dash.showTable')}
        </Button>
      </div>
      {asTable ? (
        <table className="w-full text-sm">
          <tbody>
            {data.map((d) => (
              <tr key={d.label} className="border-t border-border">
                <td className="num py-1.5">{d.label}</td>
                <td className="num text-end font-semibold">{formatMoney(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div style={{ height }} dir="ltr" role="img" aria-label={`${valueName}: ${data.map((d) => `${d.label} ${formatMoney(d.value)}`).join(', ')}`}>
          <ResponsiveContainer>
            <BarChart data={data} margin={{ top: 22, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="rgb(var(--border))" />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'rgb(var(--border))' }} tick={{ fill: 'rgb(var(--muted))', fontSize: 12 }} />
              <YAxis tickFormatter={compactMoney} tickLine={false} axisLine={false} width={48} tick={{ fill: 'rgb(var(--muted))', fontSize: 12 }} />
              <Tooltip
                cursor={{ fill: 'rgb(var(--surface-2))' }}
                content={({ active, payload, label }) =>
                  active && payload?.length ? (
                    <div className="rounded-md border border-border bg-surface px-3 py-2 text-sm shadow-lg">
                      <p className="num text-muted">{label}</p>
                      <p className="num font-bold text-foreground">
                        {valueName}: {formatMoney(Number(payload[0].value))}
                      </p>
                    </div>
                  ) : null
                }
              />
              <Bar dataKey="value" name={valueName} fill="rgb(var(--chart))" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false}>
                <LabelList
                  dataKey="value"
                  content={({ x, y, width, value, index }) =>
                    index === last && Number(value) > 0 ? (
                      <text x={Number(x) + Number(width) / 2} y={Number(y) - 6} textAnchor="middle" fontSize={12} fontWeight={600} fill="rgb(var(--foreground))">
                        {compactMoney(Number(value))}
                      </text>
                    ) : null
                  }
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
