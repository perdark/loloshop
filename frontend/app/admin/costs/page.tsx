"use client";

/**
 * «التكاليف والربح الحقيقي» — the owner's own words were «الربح مو حقيقي» (the dashboard's
 * profit is fake): «دخل المحل» there has never had materials, workshop wages, salaries or
 * losses subtracted from it. This page is where the admin builds that cost model — every
 * cost item, every recipe line, every expense is addable, editable and deletable, on
 * purpose — and reads the resulting real net profit on the first tab.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { getApiErrorMessage } from "@/lib/api";
import { getCostModel, type CostModel } from "@/lib/costs";
import { PnlTab } from "@/components/admin/costs/PnlTab";
import { CostItemsTab } from "@/components/admin/costs/CostItemsTab";
import { RecipesTab } from "@/components/admin/costs/RecipesTab";
import { ExpensesTab } from "@/components/admin/costs/ExpensesTab";

type Tab = "pnl" | "items" | "recipes" | "expenses";

const TABS: [Tab, string][] = [
  ["pnl", "الربح الحقيقي"],
  ["items", "بنود التكلفة"],
  ["recipes", "وصفة كل منتج"],
  ["expenses", "المصاريف والخسائر"],
];

export default function AdminCostsPage() {
  const [tab, setTab] = useState<Tab>("pnl");
  const [model, setModel] = useState<CostModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setModel(await getCostModel());
    } catch (e) {
      const message = getApiErrorMessage(e, "تعذّر تحميل نموذج التكاليف");
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div dir="rtl" lang="ar">
      <PageHeader
        title="التكاليف والربح الحقيقي"
        subtitle="مواد الإنتاج والأجور والرواتب والمصاريف — والصافي الحقيقي بعد خصمها كلها"
        backHref="/admin"
      />

      <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="تبويبات التكاليف">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`min-h-11 rounded-full border px-4 text-sm font-semibold transition-colors ${
              tab === key
                ? "border-orange-ink bg-orange-ink text-white"
                : "border-line bg-surface text-ink hover:border-ink/35"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "pnl" ? (
        // Tab 1 fetches its own report per month range — it does not depend on `model`, so it
        // is never blocked by a slow (or failed) model load.
        <PnlTab />
      ) : loading ? (
        <div className="space-y-3">
          <div className="skeleton h-24 rounded-2xl" />
          <div className="skeleton h-24 rounded-2xl" />
          <div className="skeleton h-24 rounded-2xl" />
        </div>
      ) : error || !model ? (
        <div className="rounded-2xl border border-danger/25 bg-surface px-6 py-12 text-center">
          <p className="font-bold text-ink">{error || "تعذّر تحميل البيانات"}</p>
          <Button className="mt-4" onClick={() => { setLoading(true); void load(); }}>
            إعادة المحاولة
          </Button>
        </div>
      ) : tab === "items" ? (
        <CostItemsTab items={model.items} lines={model.lines} onChanged={load} />
      ) : tab === "recipes" ? (
        <RecipesTab lines={model.lines} items={model.items} products={model.products} onChanged={load} />
      ) : (
        <ExpensesTab expenses={model.expenses} settings={model.settings} onChanged={load} />
      )}
    </div>
  );
}
