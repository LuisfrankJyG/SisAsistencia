CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM ('ADMIN', 'TRABAJADOR');
CREATE TYPE attendance_type AS ENUM ('ENTRADA', 'SALIDA');

CREATE TABLE workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_number VARCHAR(20) NOT NULL UNIQUE,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE,
  position VARCHAR(120),
  department VARCHAR(120),
  scheduled_start TIME,
  scheduled_end TIME,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID UNIQUE REFERENCES workers(id),
  username VARCHAR(80) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'TRABAJADOR',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- La dimensión debe coincidir con el modelo facial que se elija.
CREATE TABLE facial_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  embedding vector(512) NOT NULL,
  model_name VARCHAR(100) NOT NULL,
  consented_at TIMESTAMPTZ NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES workers(id),
  record_type attendance_type NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verification_score NUMERIC(5,4),
  method VARCHAR(30) NOT NULL DEFAULT 'FACIAL',
  notes TEXT
);

CREATE INDEX attendance_worker_date_idx ON attendance_records (worker_id, recorded_at DESC);
CREATE INDEX facial_templates_embedding_idx ON facial_templates USING hnsw (embedding vector_cosine_ops);
