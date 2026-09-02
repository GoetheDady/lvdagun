import { Streamdown } from 'streamdown';

/** @param props.text - Markdown 文本 @param props.streaming - 是否流式 @returns 文本块 */
export function MarkdownText(props: { text: string; streaming?: boolean }): React.JSX.Element {
  return (
    <Streamdown
      className="chat-markdown text-[15px] leading-7"
      mode={props.streaming ? 'streaming' : 'static'}
      isAnimating={props.streaming}
      caret={props.streaming ? 'block' : undefined}
    >
      {props.text}
    </Streamdown>
  );
}
