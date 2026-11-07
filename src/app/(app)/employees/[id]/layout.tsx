import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { ProfileBackLink } from "@/components/profile-back-link";

/**
 * The shared frame of an employee's profile. The back arrow lives here, once, so it is on every tab and the tabs do not repeat it. It is shown only
 * to someone who may open the directory it returns to. The page itself still checks who may see this employee.
 */
export default async function EmployeeProfileLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const ctx = await getSession();
  const { id } = await params;
  const canBrowse = !!ctx && can(ctx.role, "employee.view");
  return (
    <>
      {canBrowse && (
        <div className="no-print mb-3">
          <ProfileBackLink employeeId={id} />
        </div>
      )}
      {children}
    </>
  );
}
