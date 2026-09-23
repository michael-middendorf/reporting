"use client";

import { QRCodeSVG } from "qrcode.react";

const QR_NAME = "Authenticator QR code";

export function groupedSecret(secret: string) {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

type AuthenticatorSetupProps = {
  secret: string;
  otpauth?: string;
  label?: string;
  labelClassName?: string;
  secretClassName?: string;
  buttonClassName?: string;
  copied?: boolean;
  onCopy?: () => void;
};

export function AuthenticatorQr({ otpauth }: { otpauth?: string }) {
  if (!otpauth?.trim()) return null;
  // White plate and black modules. A transparent code will not scan on a dark card.
  return (
    <div
      style={{
        background: "#ffffff",
        padding: 12,
        margin: "0 0 16px",
        width: "fit-content",
        lineHeight: 0,
      }}
    >
      <QRCodeSVG
        value={otpauth}
        size={220}
        level="M"
        bgColor="#ffffff"
        fgColor="#000000"
        marginSize={4}
        title={QR_NAME}
        aria-label={QR_NAME}
      />
    </div>
  );
}

export function AuthenticatorSetup({
  secret,
  otpauth,
  label,
  labelClassName,
  secretClassName,
  buttonClassName,
  copied = false,
  onCopy,
}: AuthenticatorSetupProps) {
  return (
    <>
      <AuthenticatorQr otpauth={otpauth} />
      {label ? <p className={labelClassName}>{label}</p> : null}
      <p className={secretClassName}>{groupedSecret(secret)}</p>
      <button className={buttonClassName} type="button" onClick={() => onCopy?.()}>
        {copied ? "Copied" : "Copy key"}
      </button>
    </>
  );
}
