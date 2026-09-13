import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import {
  privacyPolicyIntro,
  privacyPolicyMeta,
  privacyPolicySections,
} from '../content/privacyPolicy';
import './Legal.css';

const renderBlock = (block) => {
  if (block.type === 'paragraph') {
    return <p className="legal-paragraph">{block.text}</p>;
  }

  if (block.type === 'subtitle') {
    return <p className="legal-subtitle">{block.text}</p>;
  }

  if (block.type === 'list') {
    return (
      <ul className="legal-list">
        {block.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }

  if (block.type === 'group') {
    return (
      <div className="legal-group">
        <h3>{block.title}</h3>
        <ul className="legal-list">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    );
  }

  return null;
};

const PrivacyPolicy = () => {
  return (
    <div className="legal-page">
      <div className="legal-shell">
        <div className="legal-hero">
          <div className="legal-hero-badge">
            <ShieldCheck size={18} />
            <span>Privacidade e proteção de dados</span>
          </div>

          <Link to="/login" className="legal-back-link">
            <ArrowLeft size={16} />
            <span>Voltar</span>
          </Link>

          <h1>{privacyPolicyMeta.title}</h1>
          <p className="legal-updated">Última atualização: {privacyPolicyMeta.lastUpdated}</p>

          <div className="legal-intro-card">
            {privacyPolicyIntro.map((paragraph) => (
              <p key={paragraph} className="legal-paragraph legal-intro-paragraph">
                {paragraph}
              </p>
            ))}
          </div>
        </div>

        <div className="legal-content">
          {privacyPolicySections.map((section) => (
            <section key={section.id} className="legal-section" id={section.id}>
              <h2>{section.title}</h2>
              <div className="legal-section-body">
                {section.blocks.map((block) => (
                  <React.Fragment key={`${section.id}-${block.type}-${block.title || block.text || (block.items || []).join('|')}`}>
                    {renderBlock(block)}
                  </React.Fragment>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicy;
