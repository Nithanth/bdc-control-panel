-- seed.sql
-- Creates a test admin user for local development.
-- Run after `supabase start` and `supabase db push`.
--
-- This inserts into auth.users (Supabase managed) and public.app_users (our table).
-- Password: "password123" (local dev only — never use in production).
--
-- Note: For local Supabase, you can also create users via the Dashboard at
-- http://localhost:54323 and then manually insert into app_users.

-- Insert into auth.users via Supabase's auth schema
insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  confirmation_token,
  raw_app_meta_data,
  raw_user_meta_data
) values (
  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'admin@bollywooddancecentral.com',
  crypt('password123', gen_salt('bf')),
  now(),
  now(),
  now(),
  '',
  '{"provider":"email","providers":["email"]}',
  '{}'
) on conflict (id) do nothing;

-- Mirror into our app_users table with owner role
insert into public.app_users (id, email, role)
values (
  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  'admin@bollywooddancecentral.com',
  'owner'
) on conflict (id) do nothing;
