import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { JulesProvider } from "./contexts/JulesContext";
import Home from "./pages/Home";

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <JulesProvider>
          <TooltipProvider>
            <Toaster
              position="bottom-right"
              toastOptions={{
                style: {
                  background: 'oklch(0.18 0.009 265)',
                  border: '1px solid oklch(1 0 0 / 10%)',
                  color: 'oklch(0.92 0.005 265)',
                },
              }}
            />
            <Router />
          </TooltipProvider>
        </JulesProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
