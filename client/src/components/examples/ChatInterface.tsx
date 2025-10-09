import ChatInterface from '../ChatInterface';

export default function ChatInterfaceExample() {
  return (
    <div className="h-96">
      <ChatInterface 
        dashboardContext="Inventory" 
        themeColor="blue" 
        prompts={['Just Listed', 'Price-O-Matic']}
        onItemClick={(type, id) => console.log('Item clicked:', type, id)}
      />
    </div>
  );
}
