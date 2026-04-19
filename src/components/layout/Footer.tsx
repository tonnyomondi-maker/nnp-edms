import polytechnicLogo from '@/assets/polytechnic-logo.jpg';

export function Footer() {
  return (
    <footer className="border-t bg-card mt-8">
      <div className="max-w-screen-lg mx-auto px-4 py-6 flex flex-col sm:flex-row items-center sm:items-start justify-between gap-4 text-center sm:text-left">
        <div className="flex items-center gap-3">
          <img
            src={polytechnicLogo}
            alt="Nyamira National Polytechnic"
            className="w-10 h-10 object-contain shrink-0"
          />
          <div className="leading-tight">
            <p className="text-sm font-semibold text-primary">
              The Nyamira National Polytechnic
            </p>
            <p className="text-xs text-secondary font-medium">Home of Innovation</p>
            <a
              href="https://nyamirapoly.ac.ke"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              nyamirapoly.ac.ke
            </a>
          </div>
        </div>

        <div className="text-xs text-muted-foreground sm:text-right">
          <p>&copy; {new Date().getFullYear()} The Nyamira National Polytechnic.</p>
          <p className="mt-1">
            Developed by the{' '}
            <a
              href="https://tonnyomondi.lovable.app"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary hover:underline"
            >
              Office of the Systems Administrator
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
