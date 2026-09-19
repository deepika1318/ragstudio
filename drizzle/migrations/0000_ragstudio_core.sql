create extension if not exists vector;

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  file_type text not null,
  file_size bigint not null default 0,
  status text not null default 'pending',
  error text,
  page_count int not null default 0,
  chunk_count int not null default 0,
  char_count int not null default 0,
  created_at timestamptz not null default now()
);

create table public.chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  chunk_index int not null,
  page int,
  content text not null,
  token_estimate int not null default 0,
  embedding vector(1536),
  created_at timestamptz not null default now()
);

create index chunks_document_id_idx on public.chunks(document_id);
create index chunks_embedding_idx on public.chunks using hnsw (embedding vector_cosine_ops);
create index chunks_content_fts_idx on public.chunks using gin (to_tsvector('english', content));

create table public.queries (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  mode text not null,
  top_k int not null default 5,
  answer text,
  insufficient boolean not null default false,
  results jsonb not null default '[]'::jsonb,
  citations jsonb not null default '[]'::jsonb,
  latency_ms int not null default 0,
  created_at timestamptz not null default now()
);

create table public.benchmark_items (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  expected_document_ids uuid[] not null default '{}',
  expected_keywords text[] not null default '{}',
  expected_answer text,
  created_at timestamptz not null default now()
);

create table public.eval_runs (
  id uuid primary key default gen_random_uuid(),
  mode text not null,
  top_k int not null default 5,
  metrics jsonb not null default '{}'::jsonb,
  per_item jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on public.documents to anon, authenticated;
grant select, insert, update, delete on public.chunks to anon, authenticated;
grant select, insert, update, delete on public.queries to anon, authenticated;
grant select, insert, update, delete on public.benchmark_items to anon, authenticated;
grant select, insert, update, delete on public.eval_runs to anon, authenticated;
grant all on public.documents, public.chunks, public.queries, public.benchmark_items, public.eval_runs to service_role;

alter table public.documents enable row level security;
alter table public.chunks enable row level security;
alter table public.queries enable row level security;
alter table public.benchmark_items enable row level security;
alter table public.eval_runs enable row level security;

create policy "public access documents" on public.documents for all to anon, authenticated using (true) with check (true);
create policy "public access chunks" on public.chunks for all to anon, authenticated using (true) with check (true);
create policy "public access queries" on public.queries for all to anon, authenticated using (true) with check (true);
create policy "public access benchmark_items" on public.benchmark_items for all to anon, authenticated using (true) with check (true);
create policy "public access eval_runs" on public.eval_runs for all to anon, authenticated using (true) with check (true);

create or replace function public.match_chunks(query_embedding vector(1536), match_count int)
returns table (
  id uuid,
  document_id uuid,
  chunk_index int,
  page int,
  content text,
  similarity float
)
language sql
stable
security invoker
set search_path = public
as $$
  select c.id, c.document_id, c.chunk_index, c.page, c.content,
         1 - (c.embedding <=> query_embedding) as similarity
  from public.chunks c
  where c.embedding is not null
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function public.match_chunks(vector, int) to anon, authenticated, service_role;

create or replace function public.bm25_stats()
returns table (total_docs bigint, avg_len float)
language sql stable security invoker set search_path = public as $$
  select count(*)::bigint, coalesce(avg(token_estimate),0)::float from public.chunks;
$$;

grant execute on function public.bm25_stats() to anon, authenticated, service_role;