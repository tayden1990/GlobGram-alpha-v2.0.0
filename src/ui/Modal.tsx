import React from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

const modalStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  width: "100vw",
  height: "100vh",
  background: "rgba(0,0,0,0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

const contentStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 8,
  padding: 24,
  minWidth: 340,
  maxWidth: "90vw",
  maxHeight: "90vh",
  overflow: "auto",
  boxShadow: "0 2px 16px rgba(0,0,0,0.2)",
};

const Modal: React.FC<ModalProps> = ({ open, onClose, children }) => {
  if (!open) return null;
  return (
    <div style={modalStyle} onClick={onClose}>
      <div style={contentStyle} onClick={e => e.stopPropagation()}>
        <button style={{ float: "right" }} onClick={onClose}>✕</button>
        {children}
      </div>
    </div>
  );
};

export default Modal;
