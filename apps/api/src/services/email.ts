/**
 * Email port — the seam for transactional mail (invites now; trial reminders,
 * receipts later in cloud). OSS binds the no-op/console default so nothing is
 * sent and no provider is required; the cloud package binds a real provider by
 * implementing this interface. No call site imports a concrete provider.
 */

export interface EmailMessage {
  to: string;
  /** Logical template name (e.g. 'workspace-invite'); the provider maps it. */
  template: string;
  /** Template variables. */
  data: Record<string, unknown>;
}

export interface EmailPort {
  send(message: EmailMessage): Promise<void>;
}

/**
 * Default OSS port: logs the message and sends nothing. Safe everywhere — a
 * self-host deployment with no mail provider configured still works, invites
 * just surface their URL in the API response as they do today.
 */
export function createConsoleEmailPort(
  logger: { info: (obj: object, msg?: string) => void } = { info: () => {} },
): EmailPort {
  return {
    async send(message: EmailMessage): Promise<void> {
      logger.info(
        { to: message.to, template: message.template },
        'email: not sent (no provider configured)',
      );
    },
  };
}
