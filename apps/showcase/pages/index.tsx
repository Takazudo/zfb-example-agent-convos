import { Island } from '@takazudo/zfb';
import Layout from '../layouts/default';
import ConvosApp from '../components/ConvosApp';
export default function Home() { return <Layout><Island when="load"><ConvosApp /></Island></Layout>; }
