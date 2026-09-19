import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const documentsQuery = queryOptions({
  queryKey: ["documents"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("documents")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  },
});

export const benchmarkQuery = queryOptions({
  queryKey: ["benchmark"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("benchmark_items")
      .select("*")
      .order("created_at");
    if (error) throw new Error(error.message);
    return data ?? [];
  },
});

export const evalRunsQuery = queryOptions({
  queryKey: ["eval_runs"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("eval_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) throw new Error(error.message);
    return data ?? [];
  },
});
