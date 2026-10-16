import { getMcpUiHost } from '../mcp-ui/host.js';
import { readPhoneThread, type PhoneControlRequest } from './phone-chats.js';
import { emitControl, phoneError, type RemoteOutbound } from './phone-live.js';
import { phoneMcpToolPayload, type PhoneMcpUiRequest } from './phone-mcp-ui.js';

const PHONE_HTML_CAP = 700_000;

/** Handle phone MCP App lookup, tool call, and resource read. */
export function dispatchPhoneMcpUi(
  cmd: PhoneControlRequest,
  opts: { onOutbound: (msg: RemoteOutbound) => void },
): cmd is PhoneMcpUiRequest {
  if (cmd.op !== 'mcp-ui' && cmd.op !== 'mcp-ui-call' && cmd.op !== 'mcp-ui-read') return false;
  const thread = readPhoneThread(cmd.chatId);
  const reqId = cmd.reqId;
  const chatId = cmd.chatId;
  if (!thread || thread.agent !== 'claude') {
    if (cmd.op === 'mcp-ui') emitControl(opts, { op: 'mcp-ui', chatId, reqId, view: null });
    else emitControl(opts, { op: cmd.op, chatId, reqId, error: 'This chat is not using Claude.' });
    return true;
  }
  if (cmd.op === 'mcp-ui-call') {
    void getMcpUiHost()
      .callTool(cmd.server, cmd.tool, cmd.args)
      .then((result) => emitControl(opts, { op: 'mcp-ui-call', chatId, reqId, result }))
      .catch((err: unknown) =>
        emitControl(opts, { op: 'mcp-ui-call', chatId, reqId, error: phoneError(err) }),
      );
    return true;
  }
  if (cmd.op === 'mcp-ui-read') {
    void getMcpUiHost()
      .readResource(cmd.server, cmd.uri)
      .then((result) => emitControl(opts, { op: 'mcp-ui-read', chatId, reqId, result }))
      .catch((err: unknown) =>
        emitControl(opts, { op: 'mcp-ui-read', chatId, reqId, error: phoneError(err) }),
      );
    return true;
  }
  const agentMessage = [...thread.messages].reverse().find((message) => message.role === 'agent');
  const payload = phoneMcpToolPayload(agentMessage?.parts, cmd.tool, cmd.callId);
  void getMcpUiHost()
    .viewForClaudeTool(cmd.tool)
    .then((view) => {
      if (!view || view.html.length > PHONE_HTML_CAP) {
        emitControl(opts, { op: 'mcp-ui', chatId, reqId, view: null });
        return;
      }
      emitControl(opts, {
        op: 'mcp-ui',
        chatId,
        reqId,
        view: {
          server: view.server,
          tool: view.tool,
          html: view.html,
          csp: view.csp,
          uri: view.uri,
          input: payload?.input ?? {},
          resultText: payload?.resultText ?? '',
          isError: payload?.isError ?? false,
        },
      });
    })
    .catch((err: unknown) => emitControl(opts, { op: 'error', chatId, message: phoneError(err) }));
  return true;
}
