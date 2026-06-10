import { useEffect } from "react";

export function useTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} | ISKOLARChat` : "ISKOLARChat";
    return () => { document.title = "ISKOLARChat"; };
  }, [title]);
}
