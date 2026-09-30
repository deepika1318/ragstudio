DROP POLICY IF EXISTS "public access documents" ON public.documents;
DROP POLICY IF EXISTS "public access chunks" ON public.chunks;
DROP POLICY IF EXISTS "public access queries" ON public.queries;
DROP POLICY IF EXISTS "public access benchmark_items" ON public.benchmark_items;
DROP POLICY IF EXISTS "public access eval_runs" ON public.eval_runs;

CREATE POLICY "read documents" ON public.documents FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "read chunks" ON public.chunks FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "read queries" ON public.queries FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "read benchmark_items" ON public.benchmark_items FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "read eval_runs" ON public.eval_runs FOR SELECT TO anon, authenticated USING (true);