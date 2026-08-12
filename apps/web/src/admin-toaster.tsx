import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { Toaster, toast } from 'sonner';

interface AdminToastApi {
  readonly success: (message: string) => void;
  readonly error: (message: string) => void;
}

const AdminToastContext = createContext<AdminToastApi | undefined>(undefined);

export function AdminToastProvider({ children }: { readonly children: ReactNode }) {
  const api = useMemo<AdminToastApi>(
    () => ({
      success: (message) => {
        toast.success(message);
      },
      error: (message) => {
        toast.error(message);
      },
    }),
    [],
  );

  return (
    <AdminToastContext.Provider value={api}>
      {children}
      <Toaster
        position="bottom-right"
        theme="dark"
        expand={false}
        gap={8}
        visibleToasts={3}
        duration={4_200}
        richColors={false}
        icons={{ success: null, error: null }}
        containerAriaLabel="管理画面の通知"
        toastOptions={{
          classNames: {
            toast: 'admin-toast',
            title: 'admin-toast__title',
          },
        }}
      />
    </AdminToastContext.Provider>
  );
}

export function useAdminToast(): AdminToastApi {
  const context = useContext(AdminToastContext);
  if (context === undefined) {
    throw new Error('useAdminToast must be used inside AdminToastProvider.');
  }
  return context;
}
