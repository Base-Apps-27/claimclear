import * as React from "react";

const QueuePreviewContext = React.createContext<boolean>(false);

export function QueuePreviewProvider({ children }: { children: React.ReactNode }) {
  return (
    <QueuePreviewContext.Provider value={true}>
      {children}
    </QueuePreviewContext.Provider>
  );
}

export function useIsQueuePreview(): boolean {
  return React.useContext(QueuePreviewContext);
}
