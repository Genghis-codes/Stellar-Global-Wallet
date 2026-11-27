"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";

export interface RenameDeviceModalProps {
  /** Current label, used as the initial value. */
  name: string;
  onClose: () => void;
  onSave: (name: string) => void;
}

/** Give a device a nickname. Names are stored in this browser only. */
export function RenameDeviceModal({ name, onClose, onSave }: RenameDeviceModalProps) {
  const [value, setValue] = useState(name);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSave(value);
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Rename device"
      description="The name is saved in this browser only."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="rename-device">
            Save
          </Button>
        </>
      }
    >
      <form id="rename-device" onSubmit={submit}>
        <Input
          label="Device name"
          value={value}
          maxLength={40}
          onChange={(event) => setValue(event.target.value)}
          hint="Leave empty to use the default name."
        />
      </form>
    </Modal>
  );
}
