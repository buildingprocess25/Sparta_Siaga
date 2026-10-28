-- Allow System Administrator to have no business role or scope.
-- Administrative permissions are determined by system_role = 'ADMIN'.

ALTER TABLE public.users
    ALTER COLUMN business_role DROP NOT NULL,
    ALTER COLUMN scope DROP NOT NULL;