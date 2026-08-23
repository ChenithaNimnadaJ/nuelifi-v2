-- Keep the live plan catalog consistent with the Neulifi brand.
update public.plan_catalog
set description = 'The complete Neulifi experience for a deeper view of your health rhythm.',
    updated_at = now()
where id = 'premium'
  and description ilike '%nuelifi%';
