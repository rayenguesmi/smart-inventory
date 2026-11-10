import { useRoute } from './router';
import Home from './pages/Home';
import { SessionForm, SessionsPage } from './pages/Sessions';
import Locations from './pages/Locations';
import Scan from './pages/Scan';
import { OcrCapture, PhotoCapture } from './pages/Capture';
import ProductForm from './pages/ProductForm';
import QuantityPage from './pages/QuantityPage';
import Products from './pages/Products';
import ProductDetail from './pages/ProductDetail';
import Unknown from './pages/Unknown';
import History from './pages/History';
import Reports from './pages/Reports';
import ImportPage from './pages/Import';
import Backup from './pages/Backup';
import Settings from './pages/Settings';
import More from './pages/More';

export default function App() {
  const { path } = useRoute();
  const seg = path.split('/').filter(Boolean);
  const id = seg[seg.length - 1] ?? '';

  switch (seg[0]) {
    case undefined:
      return <Home />;
    case 'sessions':
      return <SessionsPage />;
    case 'session':
      return <SessionForm />;
    case 'locations':
      return <Locations />;
    case 'scan':
      return <Scan />;
    case 'ocr':
      return <OcrCapture />;
    case 'photo':
      return <PhotoCapture />;
    case 'product':
      // /product/new  |  /product/edit/:id  (key forces a fresh form per product / per capture)
      return seg[1] === 'edit' ? <ProductForm key={id} id={id} /> : <ProductForm key={path + location.hash} />;
    case 'quantity':
      return <QuantityPage key={id} id={id} />;
    case 'p':
      return <ProductDetail key={id} id={id} />;
    case 'products':
      return <Products />;
    case 'unknown':
      return <Unknown />;
    case 'history':
      return <History />;
    case 'reports':
      return <Reports />;
    case 'import':
      return <ImportPage />;
    case 'backup':
      return <Backup />;
    case 'settings':
      return <Settings />;
    case 'more':
      return <More />;
    default:
      return <Home />;
  }
}
