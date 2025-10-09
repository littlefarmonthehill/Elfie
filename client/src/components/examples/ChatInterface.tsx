import ChatInterface from '../ChatInterface';

export default function ChatInterfaceExample() {
  return (
    <div className="h-96">
      <ChatInterface dashboardContext="Inventory" themeColor="blue" prompts={['Just Listed', 'Price-O-Matic']} />
    </div>
  );
}
