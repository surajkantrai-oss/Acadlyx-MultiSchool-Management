import { CreateTenantForm } from '@/components/create-tenant-form';

export default function NewSchoolPage() {
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Create school</h1>
        <p className="mt-1 text-sm text-slate-600">
          Creates the tenant record. Configure branding, domains, features and settings afterwards.
        </p>
      </div>
      <CreateTenantForm />
    </div>
  );
}
