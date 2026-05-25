"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDateShort } from "@/lib/format";

interface DailyOrdersChartProps {
  data: { date: string; count: number }[];
}

export function DailyOrdersChart({ data }: DailyOrdersChartProps) {
  const chartData = data.map((d) => ({
    ...d,
    label: formatDateShort(d.date),
  }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a15" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "#1A1A1A99" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#1A1A1A99" }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip
            formatter={(value) => [value, "الطلبات"]}
            contentStyle={{
              borderRadius: 8,
              border: "1px solid #1a1a1a20",
              fontFamily: "inherit",
            }}
          />
          <Bar dataKey="count" fill="#FF8C00" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
