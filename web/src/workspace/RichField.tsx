import { lazy, Suspense, useContext } from "react";
import { translator } from "../public/i18n";
import { LocaleContext, Loading } from "./shared";
const RichEditor = lazy(() => import("../public/composer/RichEditor"));
export function RichField({
  label,
  initial = "",
  onChange,
}: {
  label: string;
  initial?: string;
  onChange: (v: string) => void;
}) {
  const language = useContext(LocaleContext);
  return (
    <div className="ws-field ws-rich">
      <span>{label}</span>
      <Suspense fallback={<Loading />}>
        <RichEditor
          initial={initial}
          onChange={onChange}
          label={label}
          translate={translator(language)}
        />
      </Suspense>
    </div>
  );
}
