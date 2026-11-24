import { Suspense } from "react";
import { RegisterFlow } from "./register-flow";

export default function Page() {
  return (
    <Suspense>
      <RegisterFlow />
    </Suspense>
  );
}
