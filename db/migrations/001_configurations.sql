CREATE TABLE configurations (
  tenant_id text NOT NULL,
  id text NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version > 0),
  revision integer NOT NULL CHECK (revision > 0),
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT configurations_data_object CHECK (jsonb_typeof(data) = 'object')
);
