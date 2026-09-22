import { create } from "zustand";

interface HoidDialogState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useHoidDialogStore = create<HoidDialogState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
