import Header from '../Header';

export default function HeaderExample() {
  return <Header onSettingsClick={() => console.log('Settings clicked')} />;
}
